// Screens, networking, and the game loop.
(() => {
  const physics = MR.Shared.physics;
  const lobbyPhysics = physics.create(MR.Shared.lobbyMap); // walls of the lobby room
  const socket = io();
  const $ = sel => document.querySelector(sel);

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };

  // ---------- session: lets this tab rejoin its match after a drop or reload ----------
  const session = {
    token() {
      let t = null;
      try { t = sessionStorage.getItem('mr-token'); } catch { /* storage unavailable */ }
      if (!t) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        t = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        try { sessionStorage.setItem('mr-token', t); } catch { /* storage unavailable */ }
      }
      return t;
    },
    get() { try { return sessionStorage.getItem('mr-room'); } catch { return null; } },
    set(code) { try { sessionStorage.setItem('mr-room', code); } catch { /* storage unavailable */ } },
    clear() { try { sessionStorage.removeItem('mr-room'); } catch { /* storage unavailable */ } },
  };

  const SEND_MS = 50;
  const MAX_PIRATES = 6; // people + bots in one room
  const BOT_LEVELS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
  const TEAMS = { red: { name: 'Red Crew', icon: '🔴', color: '#e74c3c' }, blue: { name: 'Blue Crew', icon: '🔵', color: '#3498db' } };
  const isTeamGame = () => S.room && S.room.options.mode === 'team';
  const myTeam = () => { const me = S.room && S.room.players.find(p => p.id === S.myId); return me ? me.team : null; };
  const nameById = id => { const p = S.room && S.room.players.find(q => q.id === id); return p ? p.name : 'Someone'; };
  const INTERP_MS = 110; // render other players this far in the past for smoothness

  const S = {
    screen: 'home',
    room: null,
    myId: null,        // my player id (stays the same when I reconnect)
    world: 'ship',     // 'lobby' (Captain's Quarters) or 'ship' (the race)
    hudMode: null,
    me: { x: 0, y: 0, face: 1, walk: 0, moving: false },
    others: new Map(), // id -> { snaps: [{t,x,y}], face, walk, moving, x, y }
    lastSent: { x: 0, y: 0, t: 0 },
    countdownEnd: 0,
    goUntil: 0,
    lanUrl: null,
    tasks: [],         // my tasks: { type, stationId, x, y, area, done, lockedUntil }
    mg: null,          // open mini-game: { type, cleanup }
    taskListOpen: false,
    barrels: [],
    my: freshMy(),     // my pickup + effects; times are local performance.now() deadlines
    busy: false,
    event: null,       // current ship event: { id, phase, until, data }
    chat: [],          // recent chat messages
    bubbles: new Map(), // player id -> { text, until } speech bubble
    unread: 0,
    blockers: [],      // Kraken tentacles currently blocking doorways
    stormSeed: Math.random() * 6.28, // starting wind direction for ⛈️ Storm
    lastInterruptAt: -1e9,       // waiting for the server to answer a USE / item tap
    calls: [],         // 🤝 open co-op calls on my crew: { taskId, type, callerId, coming, ping, x, y, area }
    dismissed: new Set(), // calls I closed with ✕ ("taskId:ping")
    heard: new Map(),  // taskId -> last ping I was buzzed for
    alertPending: false, // a call came in while I was busy in a mini-game
    emotes: new Map(), // player id -> { e, at } emote playing right now
  };

  function freshMy() {
    return { pickup: null, slowUntil: 0, fogUntil: 0, boostUntil: 0, stormUntil: 0, rumUntil: 0, netUntil: 0, immuneUntil: 0, keyUntil: 0, keyTrips: 0, shield: false, scramble: false, inHatch: null };
  }

  const TASKS = MR.Shared.tasks;
  const PICKUPS = MR.Shared.pickups;
  const EVENTS = MR.Shared.events;
  const LOOKS = MR.Shared.looks;
  const eventInfo = new Map(EVENTS.types.map(t => [t.id, t]));
  const MAP = MR.Shared.map;
  const typeInfo = new Map([...TASKS.types, ...TASKS.coopTypes].map(t => [t.id, t]));
  const itemInfo = new Map(PICKUPS.items.map(i => [i.id, i]));
  const hatchInfo = new Map(MAP.hatches.map(h => [h.id, h]));
  const areaName = (x, y) => (MAP.areas.find(a => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h) || {}).name || '';
  const STATUS_ICONS = { offline: '📴', anchor: '⚓', slime: '🐙', parrot: '🦜', fog: '🌫️', storm: '⛈️', rum: '🍺', net: '🥅', wind: '💨', coin: '🛡️', key: '🗝️', immune: '⏳' };
  const statusText = list => (list || []).map(s => STATUS_ICONS[s]).join(' ');

  // ---------- screens ----------
  function showScreen(name) {
    if (S.screen === name) return;
    S.screen = name;
    document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.id === name));
    if (name === 'game') {
      resizeCanvas();
      MR.Sfx.startAmbient();
    } else {
      MR.Input.reset();
      MR.Sfx.stopAmbient();
    }
  }

  let toastTimer = null;
  function toast(msg, ms = 2500) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ---------- home ----------
  const nameInput = $('#nameInput');
  const codeInput = $('#codeInput');
  nameInput.value = store.get('mr-name') || '';
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) codeInput.value = urlRoom.toUpperCase().slice(0, 4);

  function myLook() {
    try { return LOOKS.clean(JSON.parse(store.get('mr-look') || 'null')); } catch { return { ...LOOKS.DEFAULT }; }
  }

  function myName() {
    const n = nameInput.value.trim().slice(0, 12);
    store.set('mr-name', n);
    return n;
  }

  function setHomeError(msg) { $('#homeError').textContent = msg || ''; }

  $('#createBtn').addEventListener('click', () => {
    setHomeError('');
    socket.emit('createRoom', { name: myName(), token: session.token(), look: myLook() }, res => {
      if (!res.ok) setHomeError(res.error);
    });
  });

  function join() {
    setHomeError('');
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) return setHomeError('Enter the 4-letter room code.');
    socket.emit('joinRoom', { code, name: myName(), token: session.token(), look: myLook() }, res => {
      if (!res.ok) setHomeError(res.error);
    });
  }
  $('#joinBtn').addEventListener('click', join);
  codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  // ---------- lobby ----------
  function renderLobby() {
    const room = S.room;
    const isHost = room.hostId === S.myId;
    $('#roomCode').textContent = room.code;
    $('#crewCount').textContent = `(${room.players.length}/6)`;

    const list = $('#playerList');
    list.replaceChildren(...room.players.map(p => {
      const li = document.createElement('li');
      if (p.id === S.myId) li.className = 'me';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const name = document.createElement('span');
      name.textContent = p.name;
      const tag = document.createElement('span');
      tag.className = 'tag';
      // Each label has a long form and a short form (small screens show the short one).
      const labels = [
        p.isBot && ['', 'Bot'],
        p.connected === false && ['📴', '📴 reconnecting'],
        p.id === room.hostId && ['👑', '👑 Captain'],
        p.parrot && ['🦜', '🦜'],
        p.id === S.myId && ['', '(you)'],
      ].filter(Boolean);
      for (const [short, long] of labels) {
        const l = document.createElement('span');
        l.className = 'tag-long';
        l.textContent = long + ' ';
        tag.appendChild(l);
        if (short) {
          const sh = document.createElement('span');
          sh.className = 'tag-short';
          sh.textContent = short;
          tag.appendChild(sh);
        }
      }
      li.append(dot, name, tag);
      if (isHost) tapForMenu(li, p);
      return li;
    }));

    renderCrews(room, isHost);

    const me = room.players.find(p => p.id === S.myId);
    const taken = new Set(room.players.filter(p => p.id !== S.myId).map(p => p.color));
    $('#colorGrid').replaceChildren(...room.colors.map(c => {
      const b = document.createElement('button');
      b.className = 'swatch' + (me && me.color === c ? ' mine' : '');
      b.style.background = c;
      b.disabled = taken.has(c);
      b.setAttribute('aria-label', 'Pick color ' + c);
      b.addEventListener('click', () => socket.emit('setColor', c));
      return b;
    }));

    $('#startBtn').classList.toggle('hidden', !isHost);
    $('#waitMsg').classList.toggle('hidden', isHost);

    // Game options: only the Captain can change them, so only the Captain gets the button.
    // Everyone can open Game options; only the Captain can change anything in it.
    renderOptionsPanel();
  }

  // Captain only: tap a player's name for a small menu with Kick (bots go with the Bots option).
  const playerMenu = $('#playerMenu');
  let menuFor = null;
  function tapForMenu(li, p) {
    if (p.isBot || p.id === S.myId) return;
    li.classList.add('tappable');
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `Options for ${p.name}`);
    li.addEventListener('click', e => {
      if (e.target.closest('button')) return; // the crew arrows have their own job
      e.stopPropagation();
      openPlayerMenu(p, li);
    });
  }
  function openPlayerMenu(p, li) {
    menuFor = p.id;
    $('#pmName').textContent = p.name;
    playerMenu.classList.remove('hidden');
    // Just below the name, kept on screen
    const r = li.getBoundingClientRect(), m = playerMenu.getBoundingClientRect();
    const x = Math.min(Math.max(8, r.left + 12), window.innerWidth - m.width - 8);
    const y = r.bottom + 4 + m.height > window.innerHeight - 8 ? r.top - m.height - 4 : r.bottom + 4;
    playerMenu.style.left = `${x}px`;
    playerMenu.style.top = `${y}px`;
  }
  const closePlayerMenu = () => { menuFor = null; playerMenu.classList.add('hidden'); };
  $('#pmKick').addEventListener('click', () => {
    if (menuFor) socket.emit('kick', menuFor);
    closePlayerMenu();
  });
  document.addEventListener('click', e => { if (menuFor && !playerMenu.contains(e.target)) closePlayerMenu(); });

  // ---------- crews (team mode) ----------
  let swapPick = null; // Captain's first pick when swapping between two full crews
  function renderCrews(room, isHost) {
    const team = room.options.mode === 'team';
    $('#playerList').classList.toggle('hidden', team);
    $('#crews').classList.toggle('hidden', !team);
    if (!team) { swapPick = null; return; }
    const mine = myTeam();
    const picked = swapPick && room.players.find(p => p.id === swapPick);
    if (!picked || !isHost) swapPick = null;
    const cols = Object.entries(TEAMS).map(([id, info]) => {
      const members = room.players.filter(p => p.team === id);
      const otherId = Object.keys(TEAMS).find(t => t !== id);
      const otherMembers = room.players.filter(p => p.team === otherId);
      const box = document.createElement('div');
      box.className = 'crew-box crew-' + id + (mine === id ? ' mine' : '');
      const head = document.createElement('div');
      head.className = 'crew-head';
      const title = document.createElement('span');
      title.textContent = `${info.icon} ${info.name} (${members.length}/3)`;
      head.appendChild(title);
      if (mine !== id) {
        const join = document.createElement('button');
        join.className = 'btn btn-small crew-join';
        join.textContent = 'Join';
        join.disabled = members.length >= 3 && !members.some(m => m.isBot);
        join.addEventListener('click', () => socket.emit('setTeam', id));
        head.appendChild(join);
      }
      const ul = document.createElement('ul');
      ul.className = 'crew-list';
      for (const p of members) {
        const li = document.createElement('li');
        if (p.id === S.myId) li.className = 'me';
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = p.color;
        const nm = document.createElement('span');
        nm.className = 'crew-name';
        nm.textContent = p.name + (p.id === room.hostId ? ' 👑' : '') + (p.parrot ? ' 🦜' : '');
        li.append(dot, nm);
        if (isHost) {
          li.appendChild(moveButton(p, id, otherMembers));
          tapForMenu(li, p);
        }
        ul.appendChild(li);
      }
      box.append(head, ul);
      return box;
    });
    const nodes = [...cols];
    if (isHost) {
      const sh = document.createElement('button');
      sh.className = 'btn btn-small crew-shuffle';
      sh.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h4c4 0 6 10 10 10h4M18 14l3 3-3 3M3 17h4c1.6 0 2.8-1.6 3.9-3.6M13.1 9.6C14.2 8.1 15.4 7 17 7h4M18 4l3 3-3 3"/></svg>Shuffle crews';
      sh.addEventListener('click', () => { swapPick = null; socket.emit('shuffleTeams'); });
      const hint = document.createElement('span');
      hint.className = 'crew-hint';
      hint.textContent = picked
        ? `${TEAMS[picked.team === 'red' ? 'blue' : 'red'].name} is full. Pick who swaps with ${picked.name}.`
        : 'Tap an arrow to send a pirate to the other crew.';
      const bar = document.createElement('div');
      bar.className = 'crew-tools';
      bar.append(sh, hint);
      nodes.push(bar);
    }
    $('#crews').replaceChildren(...nodes);
  }

  // Captain: ⇄ sends a pirate to the other crew. If that crew is full of people,
  // the first tap picks them and the second tap (on the other crew) picks who to swap with.
  const ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 5.5 18.5 12 12 18.5"/></svg>';
  const SWAP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/></svg>';
  function moveButton(p, teamId, otherMembers) {
    const b = document.createElement('button');
    const toId = teamId === 'red' ? 'blue' : 'red';
    b.className = `crew-move to-${toId}`;
    const pickedP = swapPick && S.room.players.find(q => q.id === swapPick);
    if (pickedP && pickedP.team !== teamId) {
      b.className = 'crew-move swap';
      b.innerHTML = `${SWAP_SVG}<span>Swap</span>`;
      b.setAttribute('aria-label', `Swap ${p.name} with ${pickedP.name}`);
      b.addEventListener('click', () => {
        socket.emit('moveTeam', { id: pickedP.id, swapWith: p.id });
        swapPick = null;
      });
      return b;
    }
    const picked = swapPick === p.id;
    if (picked) b.textContent = '✕';
    else b.innerHTML = ARROW_SVG;
    b.classList.toggle('picked', picked);
    b.setAttribute('aria-label', picked ? 'Cancel' : `Send ${p.name} to ${TEAMS[toId].name}`);
    b.addEventListener('click', () => {
      if (picked) swapPick = null;
      else if (otherMembers.length >= 3 && !otherMembers.some(q => q.isBot)) swapPick = p.id;
      else { swapPick = null; socket.emit('moveTeam', { id: p.id }); return; }
      renderLobby();
    });
    return b;
  }

  // ---------- your look (hat + face) ----------
  const lookPanel = $('#lookPanel');
  let lookRaf = 0;

  function myColor() {
    const me = S.room && S.room.players.find(p => p.id === S.myId);
    return me ? me.color : '#e74c3c';
  }

  // Draws a pirate wearing a look into a small canvas (used for the preview and the choices).
  function paintPirate(canvas, look, t, scale) {
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.translate(canvas.width / 2, canvas.height * 0.62);
    g.scale(scale, scale);
    MR.Render.drawPirate(g, { x: 0, y: 0, color: myColor(), face: 1, walk: 0, moving: false, name: '', ...look }, t);
  }

  function choiceButton(kind, opt, look) {
    const b = document.createElement('button');
    b.className = 'look-choice' + (look[kind] === opt.id ? ' on' : '');
    b.setAttribute('aria-label', opt.name);
    b.setAttribute('aria-pressed', String(look[kind] === opt.id));
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    paintPirate(c, { ...look, [kind]: opt.id }, 0, 0.95);
    const label = document.createElement('span');
    label.textContent = opt.name;
    b.append(c, label);
    b.addEventListener('click', () => {
      const next = { ...myLook(), [kind]: opt.id };
      store.set('mr-look', JSON.stringify(next));
      socket.emit('setLook', next);
      MR.Sfx.click();
      renderLookChoices();
    });
    return b;
  }

  function renderLookChoices() {
    const look = myLook();
    $('#hatChoices').replaceChildren(...LOOKS.hats.map(h => choiceButton('hat', h, look)));
    $('#eyeChoices').replaceChildren(...LOOKS.eyes.map(e => choiceButton('eyes', e, look)));
  }

  function openLook() {
    renderLookChoices();
    lookPanel.classList.remove('hidden');
    const tick = now => {
      if (lookPanel.classList.contains('hidden')) return;
      paintPirate($('#lookPreview'), myLook(), now / 1000, 1.9);
      lookRaf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(lookRaf);
    lookRaf = requestAnimationFrame(tick);
  }
  const closeLook = () => lookPanel.classList.add('hidden');

  $('#lookBtn').addEventListener('click', openLook);
  $('#lookClose').addEventListener('click', closeLook);
  $('#lookDone').addEventListener('click', closeLook);
  lookPanel.addEventListener('click', e => { if (e.target === lookPanel) closeLook(); });

  // ---------- game options panel (Captain only) ----------
  const optionsPanel = $('#optionsPanel');
  function renderOptionsPanel() {
    if (!S.room) return;
    const isHost = S.room.hostId === S.myId;
    // Other players get a view-only panel
    optionsPanel.classList.toggle('view-only', !isHost);
    $('#optionsViewNote').classList.toggle('hidden', isHost);
    const o = S.room.options;
    optionsPanel.querySelectorAll('input[data-option]').forEach(inp => { inp.checked = !!o[inp.dataset.option]; });
    $('#taskCountValue').textContent = o.taskCount;
    $('#taskCountDown').disabled = o.taskCount <= TASKS.MIN_TASKS;
    $('#taskCountUp').disabled = o.taskCount >= TASKS.MAX_TASKS;
    const humans = S.room.players.filter(p => !p.isBot).length;
    const botsHere = S.room.players.length - humans;
    $('#botCountValue').textContent = botsHere;
    $('#botCountDown').disabled = botsHere <= 0;
    $('#botCountUp').disabled = botsHere >= MAX_PIRATES - humans;
    optionsPanel.querySelectorAll('.seg-btn[data-mode]').forEach(btn => {
      const on = btn.dataset.mode === o.mode;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', String(on));
    });
    optionsPanel.querySelectorAll('.seg-btn[data-level]').forEach(btn => {
      const on = btn.dataset.level === o.botLevel;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', String(on));
    });
    if (!isHost) {
      optionsPanel.querySelectorAll('input[data-option], .step-btn, .seg-btn').forEach(el => { el.disabled = true; });
    } else {
      optionsPanel.querySelectorAll('input[data-option], .seg-btn').forEach(el => { el.disabled = false; });
    }
  }

  $('#optionsBtn').addEventListener('click', () => {
    renderOptionsPanel();
    optionsPanel.classList.remove('hidden');
  });
  $('#optionsClose').addEventListener('click', () => optionsPanel.classList.add('hidden'));
  $('#optionsDone').addEventListener('click', () => optionsPanel.classList.add('hidden'));
  optionsPanel.addEventListener('click', e => { if (e.target === optionsPanel) optionsPanel.classList.add('hidden'); });

  const setOption = (key, value) => {
    if (S.room && S.room.hostId === S.myId) socket.emit('setOption', { key, value });
  };
  optionsPanel.querySelectorAll('input[data-option]').forEach(inp => inp.addEventListener('change', () => {
    setOption(inp.dataset.option, inp.checked);
  }));
  const stepTasks = d => {
    if (!S.room) return;
    const n = Math.min(TASKS.MAX_TASKS, Math.max(TASKS.MIN_TASKS, S.room.options.taskCount + d));
    if (n !== S.room.options.taskCount) setOption('taskCount', n);
  };
  $('#taskCountDown').addEventListener('click', () => stepTasks(-1));
  $('#taskCountUp').addEventListener('click', () => stepTasks(1));
  const stepBots = d => {
    if (!S.room) return;
    const humans = S.room.players.filter(p => !p.isBot).length;
    const botsHere = S.room.players.length - humans;
    const n = Math.min(MAX_PIRATES - humans, Math.max(0, botsHere + d));
    if (n !== botsHere) setOption('botCount', n);
  };
  $('#botCountDown').addEventListener('click', () => stepBots(-1));
  optionsPanel.querySelectorAll('.seg-btn[data-level]').forEach(btn => btn.addEventListener('click', () => setOption('botLevel', btn.dataset.level)));
  optionsPanel.querySelectorAll('.seg-btn[data-mode]').forEach(btn => btn.addEventListener('click', () => setOption('mode', btn.dataset.mode)));
  $('#botCountUp').addEventListener('click', () => stepBots(1));

  $('#startBtn').addEventListener('click', () => {
    goFullscreen();
    socket.emit('startGame');
  });

  // ---------- lobby pop-up over the walkable room ----------
  const lobbyEl = $('#lobby');
  const lobbyOpen = () => !lobbyEl.classList.contains('hidden');
  function openLobby() {
    renderLobby();
    lobbyEl.classList.remove('hidden');
    MR.Input.reset();
  }
  const closeLobby = () => lobbyEl.classList.add('hidden');
  $('#crewBtn').addEventListener('click', openLobby);
  $('#lobbyClose').addEventListener('click', closeLobby);
  lobbyEl.addEventListener('click', e => { if (e.target === lobbyEl) closeLobby(); });

  // Shows the right buttons for walking around the lobby vs racing.
  function setHudMode(mode) {
    if (S.hudMode === mode) return;
    S.hudMode = mode;
    const lobby = mode === 'lobby';
    for (const id of ['#tasksBtn', '#mapBtn', '#playersBtn', '#useBtn', '#pickupBtn']) $(id).classList.toggle('hidden', lobby);
    $('#crewBtn').classList.toggle('hidden', !lobby);
    $('#lobbyBar').classList.toggle('hidden', !lobby);
    $('#codeChip').classList.toggle('hidden', !lobby);
    if (lobby) {
      $('#taskList').classList.add('hidden');
      $('#eventBanner').classList.add('hidden');
      $('#lobbyBtn').classList.add('hidden');
    } else {
      lastUseKey = '';
      lastPickupKey = '';
    }
  }

  function updateCrewBtn() {
    if (!S.room) return;
    $('#codeChipText').textContent = S.room.code;
    $('#crewBtnCount').textContent = `${S.room.players.length}/6`;
  }


  function shareLink() {
    const base = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && S.lanUrl
      ? S.lanUrl : location.origin;
    return `${base}/?room=${S.room.code}`;
  }

  $('#shareBtn').addEventListener('click', async () => {
    const link = shareLink();
    if (navigator.share) {
      try { await navigator.share({ title: 'Mutiny Rush', text: `Join my crew! Code: ${S.room.code}`, url: link }); return; }
      catch { /* cancelled or blocked: fall through */ }
    }
    try {
      await navigator.clipboard.writeText(link);
      $('#shareMsg').textContent = 'Link copied! ' + link;
    } catch {
      $('#shareMsg').textContent = link;
    }
  });

  fetch('/api/info').then(r => r.json()).then(d => { S.lanUrl = d.lanUrl; }).catch(() => {});

  function leaveRoom() {
    socket.emit('leaveRoom');
    session.clear();
    S.room = null;
    S.myId = null;
    $('#reconnect').classList.add('hidden');
    closeLobby();
    closeChat();
    S.chat = [];
    S.bubbles.clear();
    setUnread(0);
    showScreen('home');
  }

  // ---------- chat ----------
  const chatPanel = $('#chatPanel');
  const chatOpen = () => !chatPanel.classList.contains('hidden');
  const BUBBLE_MS = 5000;

  function renderChat() {
    const items = S.chat.slice().reverse().map(m => {
      const li = document.createElement('li');
      if (m.id === S.myId) li.className = 'mine';
      const who = document.createElement('span');
      who.className = 'chat-who';
      who.style.color = m.color;
      who.textContent = m.id === S.myId ? 'You' : m.name;
      const text = document.createElement('span');
      text.className = 'chat-text';
      text.textContent = m.text;
      li.append(who, text);
      return li;
    });
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'chat-empty';
      li.textContent = 'No messages yet. Say ahoy!';
      items.push(li);
    }
    $('#chatList').replaceChildren(...items);
  }

  function setUnread(n) {
    S.unread = n;
    $('#chatBadge').textContent = n > 9 ? '9+' : String(n);
    $('#chatBadge').classList.toggle('hidden', !n);
  }

  function openChat() {
    renderChat();
    setUnread(0);
    chatPanel.classList.remove('hidden');
    // On phones, don't pop the keyboard up straight away: you can read first,
    // then tap the box to type. On PC, jump straight into typing.
    if (!MR.Input.isTouch) $('#chatInput').focus();
  }
  const closeChat = () => { chatPanel.classList.add('hidden'); $('#chatInput').blur(); };

  $('#chatBtn').addEventListener('click', () => (chatOpen() ? closeChat() : openChat()));
  $('#chatClose').addEventListener('click', closeChat);
  $('#chatForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat', text, res => {
      if (res && !res.ok) toast(res.error);
    });
    input.value = '';
    // Close the phone keyboard after sending so the game is visible again.
    if (MR.Input.isTouch) input.blur();
  });

  // While typing, the phone keyboard covers the bottom of the screen: squeeze the
  // chat panel into the space that's still visible above it.
  function fitChatToKeyboard() {
    const vv = window.visualViewport;
    const typing = document.activeElement === $('#chatInput');
    chatPanel.classList.toggle('typing', typing && MR.Input.isTouch);
    if (!vv || !typing || !MR.Input.isTouch) {
      chatPanel.style.top = '';
      chatPanel.style.maxHeight = '';
      return;
    }
    chatPanel.style.top = `${vv.offsetTop + 4}px`;
    chatPanel.style.maxHeight = `${Math.max(90, vv.height - 8)}px`;
  }
  $('#chatInput').addEventListener('focus', () => setTimeout(fitChatToKeyboard, 50));
  $('#chatInput').addEventListener('blur', () => setTimeout(fitChatToKeyboard, 50));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitChatToKeyboard);
    window.visualViewport.addEventListener('scroll', fitChatToKeyboard);
  }

  socket.on('chat', m => {
    S.chat.push(m);
    if (S.chat.length > 30) S.chat.shift();
    S.bubbles.set(m.id, { text: m.text, until: performance.now() + BUBBLE_MS });
    if (chatOpen()) renderChat();
    else if (m.id !== S.myId) {
      setUnread(S.unread + 1);
      MR.Sfx.click();
    }
  });
  socket.on('chatHistory', list => {
    S.chat = list.slice();
    if (chatOpen()) renderChat();
  });

  // ---------- settings ----------
  const settingsEl = $('#settings');
  document.querySelectorAll('.settings-open').forEach(b => b.addEventListener('click', () => {
    settingsEl.querySelectorAll('input[data-setting]').forEach(inp => { inp.checked = !!MR.Settings.get(inp.dataset.setting); });
    settingsEl.classList.remove('hidden');
  }));
  $('#settingsClose').addEventListener('click', () => settingsEl.classList.add('hidden'));
  settingsEl.addEventListener('click', e => { if (e.target === settingsEl) settingsEl.classList.add('hidden'); });
  settingsEl.querySelectorAll('input[data-setting]').forEach(inp => inp.addEventListener('change', () => {
    MR.Settings.set(inp.dataset.setting, inp.checked);
    const playing = S.room && S.room.state !== 'ended';
    if (inp.dataset.setting === 'sound' && inp.checked) {
      MR.Sfx.click();
      if (S.screen === 'game' && playing) MR.Sfx.startAmbient();
    }
    if (inp.dataset.setting === 'vibration' && inp.checked) MR.vibrate(60);
  }));

  // ---------- install as an app ----------
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    $('#installBtn').classList.remove('hidden');
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $('#installBtn').classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => $('#installBtn').classList.add('hidden'));
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ---------- game screen ----------
  const canvas = $('#canvas');
  let dpr = 1;
  function resizeCanvas() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  }
  window.addEventListener('resize', () => { if (S.screen === 'game') resizeCanvas(); });

  function goFullscreen() {
    if (!MR.Input.isTouch) return;
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen().then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  }

  MR.Input.attach(canvas, goFullscreen);

  async function enterGame(room) {
    S.world = 'ship';
    closeLobby();
    setHudMode('game');
    const me = room.players.find(p => p.id === S.myId);
    Object.assign(S.me, { x: me.x, y: me.y, face: 1, walk: 0, moving: false });
    S.lastSent = { x: me.x, y: me.y, t: 0 };
    S.others.clear();
    for (const p of room.players) {
      if (p.id !== S.myId) S.others.set(p.id, newOther(p.x, p.y));
    }
    S.tasks = [];
    S.taskListOpen = false;
    S.barrels = [];
    S.event = null;
    S.blockers = [];
    S.my = freshMy();
    S.busy = false;
    resetCalls();
    closeMinigame(false);
    for (const id of ['#menu', '#playersPanel', '#results', '#picker', '#hatchPanel', '#mapPanel']) $(id).classList.add('hidden');
    renderTaskList();
    showScreen('game');
    if (!MR.Render.isReady()) {
      // Wait for the pirate font so area names draw correctly (max 1.5s).
      if (document.fonts) {
        await Promise.race([document.fonts.load('30px "Pirata One"'), new Promise(r => setTimeout(r, 1500))]).catch(() => {});
      }
      MR.Render.buildMap();
    }
  }

  // Walking around the Captain's Quarters before (and between) races.
  let lobbyHintShown = false;
  async function enterLobby(room) {
    S.world = 'lobby';
    const me = room.players.find(p => p.id === S.myId);
    Object.assign(S.me, { x: me.x, y: me.y, face: 1, walk: 0, moving: false });
    S.lastSent = { x: me.x, y: me.y, t: 0 };
    S.others.clear();
    for (const p of room.players) if (p.id !== S.myId) S.others.set(p.id, newOther(p.x, p.y));
    S.tasks = [];
    S.barrels = [];
    S.event = null;
    S.blockers = [];
    S.my = freshMy();
    S.busy = false;
    resetCalls();
    closeMinigame(false);
    for (const id of ['#menu', '#playersPanel', '#results', '#picker', '#hatchPanel', '#mapPanel', '#countdown']) $(id).classList.add('hidden');
    setHudMode('lobby');
    updateCrewBtn();
    showScreen('game');
    if (!lobbyHintShown) {
      lobbyHintShown = true;
      toast(`Walk around the ship's quarters! Tap ⚓ Crew & Options to invite friends and pick your look.`, 4000);
    }
    if (!MR.Render.isLobbyReady()) {
      if (document.fonts) {
        await Promise.race([document.fonts.load('30px "Pirata One"'), new Promise(r => setTimeout(r, 1500))]).catch(() => {});
      }
      MR.Render.buildLobby();
    }
  }

  function resetCalls() {
    S.calls = [];
    S.dismissed.clear();
    S.heard.clear();
    S.alertPending = false;
    S.coopEarly = null;
    $('#coopBanner').classList.add('hidden');
    S.emotes.clear();
    closeEmotes();
  }

  // ---------- emotes (😀) ----------
  const EMOTES = MR.Shared.emotes;
  const emotePanel = $('#emotePanel');
  const emoteOpen = () => !emotePanel.classList.contains('hidden');
  emotePanel.replaceChildren(...EMOTES.list.map(e => {
    const b = document.createElement('button');
    b.className = 'emote-choice';
    b.setAttribute('role', 'menuitem');
    b.setAttribute('aria-label', e.name);
    b.innerHTML = `<span class="emote-icon">${e.icon}</span><span class="emote-name">${e.name}</span>`;
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      closeEmotes();
      socket.emit('emote', e.id, res => { if (!res.ok) toast(res.error, 1500); });
    });
    return b;
  }));
  function closeEmotes() {
    emotePanel.classList.add('hidden');
    $('#emoteBtn').setAttribute('aria-expanded', 'false');
  }
  $('#emoteBtn').addEventListener('click', e => {
    e.stopPropagation();
    if (emoteOpen()) return closeEmotes();
    if (S.mg) return;
    emotePanel.classList.remove('hidden');
    $('#emoteBtn').setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('click', e => { if (emoteOpen() && !emotePanel.contains(e.target)) closeEmotes(); });

  socket.on('emote', ({ id, e }) => {
    const def = EMOTES.byId[e];
    if (!def) return;
    S.emotes.set(id, { e, at: performance.now(), ms: def.ms });
    // Hear your own emotes, and anyone's close by
    const o = id === S.myId ? S.me : S.others.get(id);
    if (o && Math.hypot(o.x - S.me.x, o.y - S.me.y) < 500) MR.Sfx.emote(e);
  });

  // The emote this pirate is doing right now, as { id, k: seconds in } (or null).
  function emoteFor(id, now, moving, isBot) {
    const em = S.emotes.get(id);
    if (!em) return null;
    const k = (now - em.at) / 1000;
    // Walking off ends it (bots keep their floating "ARRR!" while they run).
    if (k * 1000 > em.ms || (moving && !isBot && k > 0.25)) { S.emotes.delete(id); return null; }
    return { id: em.e, k };
  }

  function bubbleFor(id, now) {
    const b = S.bubbles.get(id);
    if (!b) return null;
    if (now > b.until) { S.bubbles.delete(id); return null; }
    return b.text;
  }

  function newOther(x, y) {
    return { snaps: [{ t: performance.now(), x, y }], x, y, face: 1, walk: 0, moving: false };
  }

  function updateHud() {
    const room = S.room;
    $('#lobbyBtn').classList.toggle('hidden', room.hostId !== S.myId);
    // Red dot on 🏆 when a rival is one task from winning.
    const close = room.teams
      ? Object.entries(room.teams).some(([t, v]) => t !== myTeam() && v.total && v.done >= v.total - 1)
      : room.players.some(p => p.id !== S.myId && p.done >= room.taskCount - 1);
    $('#playersBadge').classList.toggle('hidden', !close);
    if (!$('#playersPanel').classList.contains('hidden')) renderRankList($('#playersList'));
    if (!$('#picker').classList.contains('hidden')) renderPicker();
  }

  // ---------- task list (📋) ----------
  function renderTaskList() {
    const done = S.tasks.filter(t => t.done).length;
    $('#taskCount').textContent = `${done}/${S.tasks.length || (S.room && S.room.taskCount) || TASKS.DEFAULT_TASKS}`;
    const list = $('#taskList');
    list.classList.toggle('hidden', !S.taskListOpen || !S.tasks.length);
    $('#tasksBtn').setAttribute('aria-expanded', String(S.taskListOpen));
    const now = performance.now();
    // 🤝 Co-op tasks first: they need planning with a crewmate.
    const ordered = S.tasks.filter(t => t.coop).concat(S.tasks.filter(t => !t.coop));
    list.replaceChildren(...ordered.map(t => {
      const info = typeInfo.get(t.type);
      const li = document.createElement('li');
      if (t.done) li.className = 'done';
      const area = document.createElement('span');
      area.className = 'area';
      const lockLeft = Math.ceil((t.lockedUntil - now) / 1000);
      const who = id => (id === S.myId ? 'you' : nameById(id));
      let where = ` · ${t.coop && t.area2 ? `${t.area} + ${t.area2}` : t.area}`;
      if (!t.done && lockLeft > 0) where = ` · ⚓ ${lockLeft}s`;
      else if (isTeamGame() && t.done && t.doneBy) where = ` · ${who(t.doneBy)}${t.doneWith ? ` & ${who(t.doneWith)}` : ''}`;
      else if (t.coop && t.session) {
        where = t.session.phase === 'waiting'
          ? ` · 🤝 ${who(t.session.callerId)} waiting`
          : ` · 🤝 ${t.session.members.map(who).join(' & ')}`;
      } else if (isTeamGame() && t.busyBy && t.busyBy !== S.myId) where = ` · ⏳ ${nameById(t.busyBy)}`;
      area.textContent = where;
      if (t.coop) li.classList.add('coop-task');
      li.append(`${t.done ? '✔' : info.icon} ${t.coop && !t.done ? '🤝 ' : ''}${info.name}`, area);
      return li;
    }));
  }

  $('#tasksBtn').addEventListener('click', () => {
    S.taskListOpen = !S.taskListOpen;
    renderTaskList();
  });

  // ---------- players panel (🏆) and results ----------
  function rankedPlayers() {
    if (S.room.teams) {
      // Crews: winning/leading crew first, then by name
      const score = t => (t === S.room.winnerTeam ? 1e6 : 0) + (S.room.teams[t] ? S.room.teams[t].done : 0);
      return S.room.players.slice().sort((a, b) => score(b.team) - score(a.team) || (a.team < b.team ? -1 : 1));
    }
    return S.room.players.slice().sort((a, b) =>
      (b.id === S.room.winnerId) - (a.id === S.room.winnerId) || b.done - a.done);
  }

  function crewScoreboard() {
    const div = document.createElement('div');
    div.className = 'scoreboard';
    for (const [t, info] of Object.entries(TEAMS)) {
      const v = S.room.teams[t] || { done: 0, total: 0 };
      const row = document.createElement('div');
      row.className = 'score-row' + (t === myTeam() ? ' mine' : '');
      const label = document.createElement('span');
      label.textContent = `${info.icon} ${info.name}`;
      const bar = document.createElement('span');
      bar.className = 'bar';
      const fill = document.createElement('i');
      fill.style.width = `${v.total ? (v.done / v.total) * 100 : 0}%`;
      fill.style.background = info.color;
      bar.appendChild(fill);
      const n = document.createElement('span');
      n.className = 'count';
      n.textContent = `${v.done}/${v.total}`;
      row.append(label, bar, n);
      div.appendChild(row);
    }
    return div;
  }

  function renderRankList(ul) {
    const total = S.room.taskCount;
    const teams = S.room.teams;
    const board = ul.previousElementSibling && ul.previousElementSibling.classList.contains('scoreboard') ? ul.previousElementSibling : null;
    if (board) board.remove();
    if (teams) ul.before(crewScoreboard());
    ul.replaceChildren(...rankedPlayers().map((p, i) => {
      const li = document.createElement('li');
      if (p.id === S.myId) li.className = 'me';
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = teams ? (TEAMS[p.team] || {}).icon || '' : `${i + 1}.`;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = p.id === S.myId ? `${p.name} (you) ` : `${p.name} `;
      if (S.room.state !== 'ended' && p.status && p.status.length) {
        const st = document.createElement('span');
        st.className = 'status';
        st.textContent = statusText(p.status);
        name.appendChild(st);
      }
      const bar = document.createElement('span');
      bar.className = 'bar';
      const fill = document.createElement('i');
      const tTotal = teams && teams[p.team] ? teams[p.team].total : total;
      fill.style.width = `${tTotal ? (p.done / tTotal) * 100 : 0}%`;
      if (teams && TEAMS[p.team]) fill.style.background = TEAMS[p.team].color;
      bar.appendChild(fill);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = `${p.done}/${tTotal}`;
      li.append(rank, dot, name, bar, count);
      return li;
    }));
  }

  $('#playersBtn').addEventListener('click', () => {
    renderRankList($('#playersList'));
    $('#playersPanel').classList.remove('hidden');
  });
  $('#playersClose').addEventListener('click', () => $('#playersPanel').classList.add('hidden'));

  // ---------- ship map (🗺️): where every pirate is ----------
  const mapPanel = $('#mapPanel');
  $('#mapBtn').addEventListener('click', () => {
    if (S.room && S.room.state === 'playing' && performance.now() < S.my.fogUntil) {
      toast('🌫️ Too foggy to read the map!');
      return;
    }
    mapPanel.classList.remove('hidden');
  });
  $('#mapClose').addEventListener('click', () => mapPanel.classList.add('hidden'));
  mapPanel.addEventListener('click', e => { if (e.target === mapPanel) mapPanel.classList.add('hidden'); });

  // Greyed out with a fog icon while you're fogged.
  let mapBtnFogged = null;
  function updateMapBtn(fogged) {
    if (fogged === mapBtnFogged) return;
    mapBtnFogged = fogged;
    const btn = $('#mapBtn');
    btn.classList.toggle('fogged', fogged);
    btn.textContent = fogged ? '🌫️' : '🗺️';
    btn.setAttribute('aria-label', fogged ? 'Ship map (too foggy)' : 'Ship map');
    btn.setAttribute('aria-disabled', String(fogged));
    if (fogged) mapPanel.classList.add('hidden');
  }

  // Redrawn every frame while open, so the dots move live.
  function drawShipMap(now, players) {
    MR.Render.drawMinimap($('#shipMap'), {
      dpr,
      time: now / 1000,
      players,
      blockers: S.blockers,
      tasks: S.room.state === 'ended' ? [] : S.tasks.filter(t => !t.done).flatMap(t => {
        const spot = { x: t.x, y: t.y, icon: typeInfo.get(t.type).icon, locked: t.lockedUntil > now };
        return t.coop && t.x2 != null ? [spot, { ...spot, x: t.x2, y: t.y2 }] : [spot];
      }).concat(S.room.state === 'playing' ? S.calls.filter(c => c.callerId !== S.myId).map(c => ({ x: c.x, y: c.y, icon: '🤝', help: true })) : []),
    });
  }

  function showResults() {
    closeMinigame(false);
    for (const id of ['#menu', '#playersPanel', '#picker', '#hatchPanel', '#mapPanel']) $(id).classList.add('hidden');
    const winner = S.room.players.find(p => p.id === S.room.winnerId);
    const wt = S.room.winnerTeam && TEAMS[S.room.winnerTeam];
    const iWon = wt ? S.room.winnerTeam === myTeam() : winner && winner.id === S.myId;
    if (wt) {
      $('#winnerText').textContent = `${wt.icon} The ${wt.name} wins!`;
      $('#parrotText').textContent = iWon ? '🦜 A parrot for you and every crewmate!' : `🦜 Parrots for the whole ${wt.name}`;
    } else {
      $('#winnerText').textContent = winner
        ? (winner.id === S.myId ? 'You are the new Captain!' : `${winner.name} is the new Captain!`)
        : 'Game over!';
      $('#parrotText').textContent = winner
        ? (winner.id === S.myId ? '🦜 The parrot is yours until someone beats you!' : `🦜 ${winner.name} gets the Captain's parrot`)
        : '';
    }
    renderRankList($('#resultsList'));
    const isHost = S.room.hostId === S.myId;
    $('#againBtn').classList.toggle('hidden', !isHost);
    $('#againWait').classList.toggle('hidden', isHost);
    $('#results').classList.remove('hidden');
    MR.Render.confetti(canvas.clientWidth);
    MR.vibrate(iWon ? [80, 60, 160] : 60);
    MR.Sfx.stopAmbient();
    if (iWon) MR.Sfx.fanfare();
    else MR.Sfx.splash();
  }

  $('#againBtn').addEventListener('click', () => socket.emit('backToLobby'));
  $('#resultsLeave').addEventListener('click', leaveRoom);

  // ---------- USE button: tasks, barrels, hatches ----------
  const hasKey = (now = performance.now()) => S.my.pickup === 'key' && now < S.my.keyUntil;

  // What USE would do right now, in priority order: hatch > task > barrel.
  function useAction() {
    if (!S.room || S.room.state !== 'playing' || S.my.inHatch) return null;
    const now = performance.now();
    const dist = o => Math.hypot(o.x - S.me.x, o.y - S.me.y);
    if (hasKey(now) && S.my.keyTrips > 0) {
      const h = MAP.hatches.find(hh => dist(hh) <= PICKUPS.HATCH_DIST);
      if (h) return { kind: 'hatch', id: h.id, icon: '🕳️' };
    }
    let best = null, bestD = TASKS.USE_DIST;
    for (const t of S.tasks) {
      if (t.done || (t.busyBy && t.busyBy !== S.myId)) continue;
      // 🤝 Co-op: either lock counts; skip it when two crewmates are already on it.
      if (t.coop && t.session && t.session.members.length >= 2 && !t.session.members.includes(S.myId)) continue;
      const d = t.coop && t.x2 != null ? Math.min(dist(t), dist({ x: t.x2, y: t.y2 })) : dist(t);
      if (d <= bestD) { best = t; bestD = d; }
    }
    if (best) {
      if (best.lockedUntil > now) return { kind: 'locked', task: best, icon: '⚓' };
      return { kind: 'task', task: best, icon: best.coop ? '🤝' : typeInfo.get(best.type).icon };
    }
    if (!S.my.pickup) {
      const b = S.barrels.find(br => dist(br) <= PICKUPS.GRAB_DIST);
      if (b) return { kind: 'barrel', id: b.id, icon: b.kind === 'key' ? '🗝️' : '🛢️' };
    }
    return null;
  }

  function useNearby() {
    if (performance.now() < S.my.netUntil) {
      toast("🥅 You're tangled in a net!");
      return;
    }
    const a = useAction();
    if (!a || S.mg || S.busy) return;
    if (a.kind === 'locked') {
      toast(`⚓ Anchored! Free in ${Math.ceil((a.task.lockedUntil - performance.now()) / 1000)}s`);
      return;
    }
    if (a.kind === 'task') {
      const t = a.task;
      S.mg = { type: t.type, taskId: t.id, cleanup: null, pending: true };
      socket.emit('startTask', t.id, res => {
        if (!S.mg || S.mg.taskId !== t.id) return;
        if (!res.ok) {
          S.mg = null;
          toast(res.error, 3500);
          return;
        }
        if (res.coop) openCoop(t.type, t.id);
        else openMinigame(t.type, res.scramble, t.id);
      });
      return;
    }
    S.busy = true;
    if (a.kind === 'barrel') {
      socket.emit('grabBarrel', a.id, res => {
        S.busy = false;
        if (!res.ok) return toast(res.error);
        const it = itemInfo.get(res.item);
        MR.Sfx.whoosh();
        MR.vibrate(40);
        toast(`${it.icon} ${it.name}! ${it.desc}`, 3000);
      });
    } else if (a.kind === 'hatch') {
      socket.emit('hatch', { action: 'enter', id: a.id }, res => {
        S.busy = false;
        if (!res.ok) toast(res.error);
      });
    }
  }

  function openMinigame(type, scramble, taskId) {
    const info = typeInfo.get(type);
    const stage = $('#mgStage');
    stage.replaceChildren();
    $('#mgTitle').textContent = `${scramble ? '🦜' : info.icon} ${info.name}`;
    $('#mgHint').textContent = '';
    $('#mg').classList.remove('hidden');
    MR.Input.reset();
    const ctx = {
      stage,
      scramble: !!scramble,
      hint: text => { $('#mgHint').textContent = (scramble ? '🦜 Scrambled! ' : '') + text; },
      done: () => finishMinigame(taskId),
    };
    S.mg = { type, taskId, cleanup: MR.Minigames[type](ctx), pending: false };
  }

  // 🤝 Co-op mini-game: the server runs it; this screen shows it and sends taps.
  function openCoop(type, taskId) {
    const info = typeInfo.get(type);
    const stage = $('#mgStage');
    stage.replaceChildren();
    $('#mgTitle').textContent = `🤝 ${info.name}`;
    $('#mgHint').textContent = '';
    $('#mg').classList.remove('hidden');
    MR.Input.reset();
    const view = MR.Coop[type]({
      stage,
      myId: S.myId,
      hint: text => { $('#mgHint').textContent = text; },
      send: data => socket.emit('coop', data),
      info: id => {
        const p = S.room && S.room.players.find(q => q.id === id);
        return p ? { name: p.name, color: p.color } : { name: 'Someone', color: '#999' };
      },
      distTo: id => {
        const o = S.others.get(id);
        const t = S.tasks.find(x => x.id === taskId);
        if (!o || !t) return null;
        const spot = S.mg && S.mg.lastState ? S.mg.lastState.target : t;
        return Math.max(0, Math.round(Math.hypot(o.x - spot.x, o.y - spot.y) / 40));
      },
    });
    S.mg = { type, taskId, coop: true, cleanup: view.cleanup, update: view.update, pending: false, lastState: null };
    if (S.coopEarly && S.coopEarly.taskId === taskId) applyCoopState(S.coopEarly);
    S.coopEarly = null;
  }

  function applyCoopState(st) {
    S.mg.lastState = st;
    S.mg.update(st);
  }

  function finishMinigame(taskId) {
    if (!S.mg || S.mg.taskId !== taskId) return;
    socket.emit('completeTask', taskId, res => {
      if (!res.ok) toast(res.error);
    });
    closeMinigame(false);
  }

  function closeMinigame(notifyServer) {
    if (!S.mg) return;
    if (S.mg.cleanup) S.mg.cleanup();
    S.mg = null;
    $('#mg').classList.add('hidden');
    $('#mgStage').replaceChildren();
    if (notifyServer) socket.emit('cancelTask');
    // A crewmate called while I was busy: tell me now.
    if (S.alertPending) {
      S.alertPending = false;
      if (pickCall()) callAlert();
    }
  }

  $('#useBtn').addEventListener('click', useNearby);
  $('#mgClose').addEventListener('click', () => closeMinigame(true));
  window.addEventListener('keydown', e => {
    if (S.screen !== 'game' || e.target.tagName === 'INPUT') return;
    if (e.key === 'e' || e.key === 'E') useNearby();
    if (e.key === 'q' || e.key === 'Q') usePickupBtn();
    if (e.key === 'Escape') {
      closeMinigame(true);
      $('#picker').classList.add('hidden');
    }
  });

  // ---------- pickup slot + target picker ----------
  function usePickupBtn() {
    const it = S.my.pickup && itemInfo.get(S.my.pickup);
    if (!it || S.busy || S.mg || S.my.inHatch || !S.room || S.room.state !== 'playing') return;
    if (it.target === 'passive') {
      const left = Math.ceil((S.my.keyUntil - performance.now()) / 1000);
      toast(`🗝️ Walk onto a glowing hatch and tap USE. ${left}s, ${S.my.keyTrips} trip${S.my.keyTrips === 1 ? '' : 's'} left.`, 3000);
      return;
    }
    if (it.target === 'player') {
      renderPicker();
      $('#picker').classList.remove('hidden');
      return;
    }
    sendPickup(null);
  }

  function sendPickup(targetId) {
    S.busy = true;
    socket.emit('usePickup', targetId, res => {
      S.busy = false;
      if (!res.ok) toast(res.error);
    });
  }

  function renderPicker() {
    const it = S.my.pickup && itemInfo.get(S.my.pickup);
    if (!it || it.target !== 'player') {
      $('#picker').classList.add('hidden');
      return;
    }
    $('#pickerTitle').textContent = `${it.icon} ${it.name}: pick a rival`;
    $('#pickerDesc').textContent = it.desc;
    const rivals = S.room.players.filter(p => p.id !== S.myId);
    const crew = myTeam();
    const list = $('#pickerList');
    if (!rivals.length) {
      list.replaceChildren(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'No rivals on board!' }));
      return;
    }
    list.replaceChildren(...rivals.map(p => {
      const why = (isTeamGame() && crew && p.team === crew && 'Crewmate') || (p.blocked && p.blocked[it.id]);
      const b = document.createElement('button');
      b.className = 'target';
      b.disabled = !!why;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const name = document.createElement('span');
      name.textContent = `${p.name} `;
      const st = document.createElement('span');
      st.className = 'status';
      st.textContent = statusText(p.status);
      name.appendChild(st);
      const right = document.createElement('span');
      right.className = 'why';
      right.textContent = why || `${p.done}/${S.room.taskCount}`;
      b.append(dot, name, right);
      b.addEventListener('click', () => {
        $('#picker').classList.add('hidden');
        sendPickup(p.id);
      });
      return b;
    }));
  }

  $('#pickupBtn').addEventListener('click', usePickupBtn);
  $('#pickerClose').addEventListener('click', () => $('#picker').classList.add('hidden'));

  let lastPickupKey = '';
  function updatePickupBtn(now) {
    const btn = $('#pickupBtn');
    const it = S.my.pickup && itemInfo.get(S.my.pickup);
    const keyLeft = it && it.id === 'key' ? Math.max(0, S.my.keyUntil - now) : 0;
    btn.style.setProperty('--ring', it && it.id === 'key' ? (keyLeft / 30000).toFixed(3) : 0);
    const key = `${it ? it.id : ''}|${S.my.keyTrips}|${S.room.state}|${!!S.my.inHatch}`;
    if (key === lastPickupKey) return;
    lastPickupKey = key;
    btn.className = 'pickup-btn' + (!it ? ' empty' : it.target === 'passive' ? ' passive' : it.target === 'self' ? ' self' : '');
    btn.classList.toggle('hidden', S.room.state === 'ended' || !!S.my.inHatch);
    $('#pickupIcon').textContent = it ? it.icon : '';
    btn.setAttribute('aria-label', it ? `Use ${it.name}` : 'No item');
    $('#pickupTrips').classList.toggle('hidden', !it || it.id !== 'key');
    $('#pickupTrips').textContent = S.my.keyTrips;
    if (!$('#picker').classList.contains('hidden')) renderPicker();
  }

  // ---------- inside a hatch ----------
  let hatchShownFor = null;
  function updateHatchPanel(now) {
    const id = S.my.inHatch;
    const panel = $('#hatchPanel');
    if (!id) {
      if (hatchShownFor) panel.classList.add('hidden');
      hatchShownFor = null;
      return;
    }
    const left = Math.max(0, Math.ceil((S.my.hatchEnteredAt + 5000 - now) / 1000));
    const trips = S.my.keyTrips;
    $('#hatchTimer').textContent = `· ${left}s · 🗝️ ${trips} trip${trips === 1 ? '' : 's'} left`;
    const key = `${id}|${S.my.keyTrips}`;
    if (hatchShownFor === key) return;
    hatchShownFor = key;
    const here = hatchInfo.get(id);
    $('#hatchName').textContent = `${areaName(here.x, here.y)} hatch`;
    $('#hatchDest').replaceChildren(...hatchDests(id).map(h => {
      const b = document.createElement('button');
      b.className = 'btn btn-use';
      b.textContent = `→ ${areaName(h.x, h.y)}`;
      const near = tasksNear(h);
      if (near.length) {
        const n = document.createElement('span');
        n.className = 'near';
        n.textContent = `near ${near.map(t => typeInfo.get(t.type).icon).join(' ')}`;
        b.appendChild(n);
      }
      b.disabled = S.my.keyTrips <= 0;
      b.addEventListener('click', () => travelTo(h.id));
      return b;
    }));
    panel.classList.remove('hidden');
  }

  const NEAR_DIST = 450; // a task this close to a hatch counts as "near"
  const hatchDests = id => {
    const here = hatchInfo.get(id);
    return MAP.hatches.filter(h => h.net === here.net && h.id !== id);
  };
  const tasksNear = h => S.tasks.filter(t => !t.done && Math.hypot(t.x - h.x, t.y - h.y) <= NEAR_DIST);

  function travelTo(hatchId) {
    if (S.busy || S.my.keyTrips <= 0) return;
    S.busy = true;
    MR.Sfx.tone(220, 0.4, 'sine', 0.12);
    socket.emit('hatch', { action: 'travel', id: hatchId }, res => {
      S.busy = false;
      if (!res.ok) toast(res.error);
    });
  }

  // Ship map inside the hatch panel: redrawn every frame for the glow animation.
  let hatchView = null;
  function drawHatchMap(now) {
    const here = hatchInfo.get(S.my.inHatch);
    const meInfo = S.room.players.find(p => p.id === S.myId);
    hatchView = MR.Render.drawMinimap($('#hatchMap'), {
      dpr,
      time: now / 1000,
      here,
      color: meInfo && meInfo.color,
      blockers: S.blockers,
      dests: S.my.keyTrips > 0 ? hatchDests(here.id).map(h => ({ hatch: h, label: areaName(h.x, h.y) })) : [],
      tasks: S.tasks.filter(t => !t.done).map(t => ({ x: t.x, y: t.y, icon: typeInfo.get(t.type).icon, locked: t.lockedUntil > now })),
    });
  }

  $('#hatchMap').addEventListener('pointerdown', e => {
    if (!hatchView || !S.my.inHatch) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    let best = null, bestD = 40; // tap radius in screen pixels
    for (const h of hatchDests(S.my.inHatch)) {
      const d = Math.hypot(h.x * hatchView.s + hatchView.ox - px, h.y * hatchView.s + hatchView.oy - py);
      if (d < bestD) { best = h; bestD = d; }
    }
    if (best) travelTo(best.id);
  });

  $('#hatchExit').addEventListener('click', () => {
    if (S.busy) return;
    S.busy = true;
    socket.emit('hatch', { action: 'exit' }, res => {
      S.busy = false;
      if (!res.ok) toast(res.error);
    });
  });

  $('#menuBtn').addEventListener('click', () => $('#menu').classList.remove('hidden'));
  $('#resumeBtn').addEventListener('click', () => $('#menu').classList.add('hidden'));
  $('#lobbyBtn').addEventListener('click', () => socket.emit('backToLobby'));
  $('#quitBtn').addEventListener('click', leaveRoom);

  // ---------- network ----------
  socket.on('room', room => {
    // Ignore late updates for a room I just left (or am not part of).
    if (!S.myId || !room.players.some(p => p.id === S.myId)) return;
    const prev = S.room;
    S.room = room;
    const inGame = room.state !== 'lobby';
    if (inGame && (!prev || prev.state === 'lobby')) enterGame(room);
    if (!inGame) {
      if (!prev || prev.state !== 'lobby') enterLobby(room);
      const ids = new Set(room.players.map(p => p.id));
      for (const id of S.others.keys()) if (!ids.has(id)) S.others.delete(id);
      updateCrewBtn();
      renderLobby();
      return;
    }
    // Drop pirates who left mid-game.
    const ids = new Set(room.players.map(p => p.id));
    for (const id of S.others.keys()) if (!ids.has(id)) S.others.delete(id);
    updateHud();
    if (room.state === 'ended' && (!prev || prev.state !== 'ended')) showResults();
    else if (room.state === 'ended') {
      // Someone left or the host changed while on the results screen.
      renderRankList($('#resultsList'));
      const isHost = room.hostId === S.myId;
      $('#againBtn').classList.toggle('hidden', !isHost);
      $('#againWait').classList.toggle('hidden', isHost);
    }
  });

  socket.on('tasks', list => {
    const before = new Map(S.tasks.map(t => [t.id, t.done]));
    const now = performance.now();
    const tasks = list.map(t => ({ ...t, lockedUntil: t.lockedMs ? now + t.lockedMs : 0 }));
    S.tasks = tasks;
    for (const t of tasks) {
      if (t.done && before.get(t.id) === false) {
        MR.Render.burst(t.x, t.y - 20);
        MR.Sfx.good();
        MR.vibrate(40);
        const left = tasks.filter(tk => !tk.done).length;
        const who = t.doneBy && t.doneBy !== S.myId ? `${nameById(t.doneBy)}: ` : '';
        if (left) toast(`✔ ${who}${typeInfo.get(t.type).name} done! ${left} to go.`, 1800);
      }
    }
    renderTaskList();
  });

  socket.on('me', m => {
    const now = performance.now();
    const wasIn = S.my.inHatch;
    S.my = {
      pickup: m.pickup,
      slowUntil: now + m.slowMs,
      fogUntil: now + m.fogMs,
      boostUntil: now + m.boostMs,
      stormUntil: now + m.stormMs,
      rumUntil: now + m.rumMs,
      netUntil: now + m.netMs,
      immuneUntil: now + m.immuneMs,
      keyUntil: now + m.keyMs,
      keyTrips: m.keyTrips,
      shield: m.shield,
      scramble: m.scramble,
      inHatch: m.inHatch,
      hatchEnteredAt: m.inHatch && m.inHatch === wasIn ? S.my.hatchEnteredAt : now,
    };
    // Fog hides the map; the hatch has its own map.
    if (m.fogMs > 0 || m.inHatch) $('#mapPanel').classList.add('hidden');
    if (m.inHatch && m.inHatch !== wasIn) {
      // Entering or moving through the tunnels
      MR.Input.reset();
      $('#picker').classList.add('hidden');
      MR.Sfx.creak();
    }
  });

  socket.on('barrels', list => { S.barrels = list; });

  // ---------- ship events ----------
  socket.on('event', e => {
    if (e.phase === 'end') {
      S.event = null;
      S.blockers = [];
      return;
    }
    const now = performance.now();
    S.event = { id: e.id, phase: e.phase, until: now + e.ms, data: e.data || {} };
    S.blockers = e.phase === 'active' && e.id === 'kraken' ? e.data.rects : [];
    if (e.phase === 'warning') {
      MR.Sfx.horn();
      MR.vibrate([120, 80, 120]);
      return;
    }
    if (e.id === 'kraken') MR.Sfx.roar();
    if (e.id === 'wave') {
      MR.Sfx.splash();
      if (S.screen === 'game') ouch();
    }
    if (e.id === 'eclipse') MR.Sfx.drone();
  });

  let lastBanner = '';
  function updateEventBanner(now) {
    const banner = $('#eventBanner');
    const ev = S.event;
    if (!ev || !S.room || S.room.state !== 'playing') {
      if (lastBanner) banner.classList.add('hidden');
      lastBanner = '';
      return;
    }
    const info = eventInfo.get(ev.id);
    const left = Math.max(0, Math.ceil((ev.until - now) / 1000));
    const warn = ev.phase === 'warning';
    const key = `${ev.id}|${ev.phase}|${left}`;
    if (key === lastBanner) return;
    lastBanner = key;
    banner.classList.remove('hidden');
    banner.classList.toggle('warning', warn);
    $('#eventIcon').textContent = warn ? '⚠️' : info.icon;
    $('#eventText').textContent = warn ? info.warning : info.desc;
    $('#eventTime').textContent = `${left}s`;
  }

  socket.on('interrupt', () => {
    S.lastInterruptAt = performance.now();
    if (S.mg) {
      closeMinigame(false);
      toast('You got knocked out of your task! Try it again.');
    }
  });

  socket.on('notice', ({ text }) => toast(text, 2500));

  // The Captain removed me from the lobby: back to the home screen (I can join again with the code).
  socket.on('kicked', () => {
    const code = S.room && S.room.code;
    leaveRoom();
    if (code) codeInput.value = code;
    setHomeError('The Captain removed you from the room.');
    toast('The Captain removed you from the room. You can join again with the code.', 4500);
  });

  // ---------- 🤝 co-op tasks: the live game, the crew's calls ----------
  socket.on('coop', st => {
    const mine = S.mg && S.mg.taskId === st.taskId;
    if (st.phase === 'done') {
      if (mine) closeMinigame(false);
      MR.Sfx.fanfare();
      return;
    }
    if (st.phase === 'soloTurned') {
      if (mine) closeMinigame(false);
      toast(`🏦 Key turned! Run to the other lock in the ${st.area}: ${Math.round(st.ms / 1000)}s`, 4000);
      return;
    }
    if (!mine) return;
    if (!S.mg.update) { S.coopEarly = st; return; } // arrived before the USE answer
    const was = S.mg.lastState;
    applyCoopState(st);
    if (was && was.phase === 'waiting' && st.phase === 'active') { MR.Sfx.good(); MR.vibrate([60, 40, 60]); }
    if (was && was.phase === 'active' && st.phase === 'waiting') toast('Your crewmate left. Calling the crew again…', 2500);
  });

  socket.on('coopCalls', calls => {
    S.calls = calls;
    for (const c of calls) {
      if (c.callerId === S.myId) continue;
      if ((S.heard.get(c.taskId) || 0) >= c.ping) continue;
      S.heard.set(c.taskId, c.ping);
      // New call (or the 20s reminder): buzz now, or once the current mini-game is over.
      if (S.mg) S.alertPending = true;
      else callAlert();
    }
    renderCoopBanner(true);
  });

  socket.on('coopEnd', e => {
    if (e.by === S.myId) return;
    const info = typeInfo.get(e.type);
    if (e.reason === 'joined' && e.wasComing) toast(`👍 ${nameOf(e.by)} got there first, back to your tasks!`, 2500);
    else if (e.reason === 'left' && e.wasComing) toast(`${nameOf(e.by)} left ${info.place}`, 2500);
  });

  function callAlert() {
    MR.Sfx.horn();
    MR.vibrate([150, 80, 150]);
  }

  // The banner at the bottom: "🤝 Rahul needs a hand…" / "Priya is going" / "Heading to…"
  let bannerKey = '';
  function renderCoopBanner(force = false) {
    const el = $('#coopBanner');
    const playing = S.room && S.room.state === 'playing';
    const call = playing && !S.my.inHatch ? pickCall() : null;
    const key = call ? `${call.taskId}|${call.ping}|${call.coming.join()}|${!!S.mg}` : '';
    if (!force && key === bannerKey) return;
    bannerKey = key;
    if (!call || S.mg) { el.classList.add('hidden'); return; }
    const info = typeInfo.get(call.type);
    const caller = nameOf(call.callerId);
    const imComing = call.coming.includes(S.myId);
    const other = call.coming.find(id => id !== S.myId);
    el.classList.remove('hidden');
    el.classList.toggle('chip', imComing);
    const text = document.createElement('span');
    text.className = 'coop-banner-text';
    const btns = [];
    const button = (cls, label, fn) => {
      const b = document.createElement('button');
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', fn);
      btns.push(b);
    };
    if (imComing) {
      text.textContent = `🤝 Heading to ${info.place} · ${call.area}`;
      button('coop-x', '✕', () => socket.emit('coopReply', { taskId: call.taskId, action: 'cancel' }));
    } else {
      text.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = caller;
      text.append('🤝 ', b, ` needs a hand at ${info.place}!`);
      if (other) text.append(` 🏃 ${nameOf(other)} is going`);
      button(other ? 'btn btn-small coop-go anyway' : 'btn btn-go coop-go', other ? 'Go anyway' : '🏃 On my way!', () => {
        socket.emit('coopReply', { taskId: call.taskId, action: 'coming' });
      });
      button('coop-x', '✕', () => {
        S.dismissed.add(`${call.taskId}:${call.ping}`);
        renderCoopBanner(true);
      });
    }
    el.replaceChildren(text, ...btns);
  }

  // The call to show: the one I'm heading to, else the newest one I haven't closed.
  function pickCall() {
    const others = S.calls.filter(c => c.callerId !== S.myId && !(S.mg && S.mg.taskId === c.taskId));
    return others.find(c => c.coming.includes(S.myId))
      || others.slice().reverse().find(c => !S.dismissed.has(`${c.taskId}:${c.ping}`))
      || null;
  }

  const nameOf = id => {
    const p = S.room && S.room.players.find(pl => pl.id === id);
    return p ? p.name : 'Someone';
  };

  function ouch() {
    const game = $('#game');
    game.classList.remove('shake-screen');
    void game.offsetWidth;
    game.classList.add('shake-screen');
    MR.vibrate([100, 50, 100]);
    MR.Sfx.bad();
  }

  const HIT_MSG = {
    anchor: by => `⚓ ${by} anchored one of your tasks!`,
    slime: by => `🐙 ${by} slimed you! Half speed for 8s.`,
    parrot: by => `🦜 ${by} sent a parrot! Your next task is scrambled.`,
    wave: by => `🌊 ${by}'s Big Wave washed away one of your tasks!`,
    net: by => `🥅 ${by} caught you in a fishing net! Stuck for 6s.`,
  };

  socket.on('fx', fx => {
    if (fx.kind === 'puff') {
      MR.Render.puff(fx.x, fx.y);
      if (Math.hypot(fx.x - S.me.x, fx.y - S.me.y) < 600) MR.Sfx.creak();
      return;
    }
    if (fx.kind !== 'sabotage') return;
    const it = itemInfo.get(fx.item);
    const me = S.myId;
    const now = performance.now();
    if (it.target === 'self') {
      if (fx.item === 'coin') {
        if (fx.by === me) toast('🛡️ Lucky Coin ready! It blocks the next sabotage.');
        else toast(`🛡️ ${nameOf(fx.by)} is carrying a Lucky Coin`, 1800);
      } else if (fx.item === 'wind') {
        MR.Sfx.gust();
        if (fx.by === me) toast('💨 Wind in the sails! Double speed for 6s.');
        else toast(`💨 ${nameOf(fx.by)} caught the wind!`, 1800);
      }
      return;
    }
    if (it.target === 'all') {
      const by = nameOf(fx.by);
      const ALL = {
        fog: { mine: '🌫️ You rolled in the fog on everyone!', hit: `🌫️ ${by} rolled in the fog!`, affected: S.my.fogUntil > now },
        storm: { mine: '⛈️ You called down a storm!', hit: `⛈️ ${by} called a storm! Hold on tight for 8s.`, affected: S.my.stormUntil > now },
        rum: { mine: '🍺 You passed the rum around! Everyone else is seeing double.', hit: `🍺 ${by} got everyone drunk! Your controls are reversed for 8s.`, affected: S.my.rumUntil > now },
        alarm: { mine: "🔔 You rang the ship's alarm!", hit: `🔔 ${by} rang the alarm! Your task was cancelled.`, affected: now - S.lastInterruptAt < 1500 },
      }[fx.item];
      if (fx.item === 'alarm') MR.Sfx.alarm();
      if (fx.item === 'storm' && (fx.by === me || ALL.affected)) MR.Sfx.thunder();
      if (fx.item === 'rum' && ALL.affected) MR.Sfx.hiccup();
      if (fx.by === me) toast(ALL.mine);
      else if (ALL.affected) {
        toast(ALL.hit, 3000);
        ouch();
      } else if (fx.item === 'alarm') {
        toast(`🔔 ${by} rang the ship's alarm!`, 1800);
      }
      return;
    }
    if (fx.item === 'net' && !fx.blocked) MR.Sfx.net();
    if (fx.target === me) {
      if (fx.blocked) toast(`🛡️ Your Lucky Coin blocked ${nameOf(fx.by)}'s ${it.icon}!`);
      else {
        toast(HIT_MSG[fx.item](nameOf(fx.by)), 3000);
        ouch();
      }
    } else if (fx.by === me) {
      toast(fx.blocked
        ? `🛡️ ${nameOf(fx.target)}'s Lucky Coin blocked your ${it.icon}!`
        : `${it.icon} Got ${nameOf(fx.target)}!`);
    } else {
      toast(`${nameOf(fx.by)} ${it.icon} ${nameOf(fx.target)}${fx.blocked ? ' (blocked 🛡️)' : ''}`, 1800);
    }
  });

  socket.on('countdown', ({ ms }) => {
    S.countdownEnd = performance.now() + ms;
  });

  socket.on('state', ({ p }) => {
    const now = performance.now();
    for (const [id, x, y, hidden] of p) {
      if (id === S.myId) continue;
      let o = S.others.get(id);
      if (!o) S.others.set(id, (o = newOther(x, y)));
      // Popping out of a hatch: appear there instead of sliding across the map.
      if (o.hidden && !hidden) o.snaps = [];
      o.hidden = !!hidden;
      o.snaps.push({ t: now, x, y });
      if (o.snaps.length > 12) o.snaps.shift();
    }
  });

  socket.on('correct', ({ x, y }) => {
    S.me.x = x;
    S.me.y = y;
    S.lastSent = { x, y, t: performance.now() };
  });

  // ---------- connection drops and rejoining ----------
  socket.on('you', ({ id, code }) => {
    S.myId = id;
    session.set(code);
  });

  socket.on('disconnect', () => {
    // Keep the match on screen; socket.io reconnects by itself.
    // The server cancels any task in progress, so close the mini-game too.
    closeMinigame(false);
    $('#picker').classList.add('hidden');
    if (S.room) $('#reconnect').classList.remove('hidden');
  });

  socket.on('connect', () => {
    const code = session.get();
    if (!code) return;
    socket.emit('rejoin', { code, token: session.token() }, res => {
      $('#reconnect').classList.add('hidden');
      if (res.ok) {
        if (S.room) toast('✔ Back on board!');
        return;
      }
      session.clear();
      if (S.room) {
        S.room = null;
        S.myId = null;
        showScreen('home');
        toast(res.error, 3500);
      }
    });
  });

  $('#reconnectLeave').addEventListener('click', leaveRoom);

  // ---------- loop ----------
  function updateMe(dt, now) {
    const me = S.me;
    // You can keep walking with the chat open (typed letters never move you: see touch.js).
    const canWalk = S.room && (S.room.state === 'playing' || (S.room.state === 'lobby' && !lobbyOpen()));
    if (!canWalk || !socket.connected || S.mg || S.my.inHatch || !$('#menu').classList.contains('hidden')) {
      me.moving = false;
      return;
    }
    if (now < S.my.netUntil) {
      me.moving = false; // 🥅 tangled in a net
      return;
    }
    let v = MR.Input.vector();
    if (now < S.my.rumUntil) v = { x: -v.x, y: -v.y }; // 🍺 reversed controls
    const speedMul = PICKUPS.speedMul(now < S.my.slowUntil, now < S.my.boostUntil);
    let mx = v.x * speedMul, my = v.y * speedMul;
    if (S.event && S.event.id === 'wave' && S.event.phase === 'active') {
      // 🌊 The rogue wave pushes everyone one way
      mx += S.event.data.dir.x * EVENTS.WAVE_PUSH;
      my += S.event.data.dir.y * EVENTS.WAVE_PUSH;
    }
    if (now < S.my.stormUntil) {
      // ⛈️ Gusts push you around; the wind direction swings slowly.
      const a = (now / 1000) * 0.9 + S.stormSeed;
      mx += Math.cos(a) * PICKUPS.STORM_DRIFT;
      my += Math.sin(a) * PICKUPS.STORM_DRIFT;
    }
    if (mx || my) {
      const res = S.world === 'lobby'
        ? lobbyPhysics.move(me.x, me.y, mx, my, dt)
        : physics.move(me.x, me.y, mx, my, dt, 1, S.blockers);
      me.moving = Math.hypot(res.x - me.x, res.y - me.y) > 0.3;
      me.x = res.x;
      me.y = res.y;
      if (Math.abs(mx) > 0.1) me.face = mx > 0 ? 1 : -1;
      if (me.moving) {
        me.walk += dt * 12;
        // Creaky footstep on each step of the waddle
        const step = Math.floor(me.walk / Math.PI);
        if (step !== S.lastStep) {
          S.lastStep = step;
          MR.Sfx.step();
        }
      }
    } else {
      me.moving = false;
    }
    const changed = me.x !== S.lastSent.x || me.y !== S.lastSent.y;
    if (changed && now - S.lastSent.t >= SEND_MS) {
      socket.emit('move', { x: me.x, y: me.y });
      S.lastSent = { x: me.x, y: me.y, t: now };
    }
  }

  function updateOthers(dt, now) {
    const rt = now - INTERP_MS;
    for (const o of S.others.values()) {
      const s = o.snaps;
      let x = s[s.length - 1].x, y = s[s.length - 1].y;
      for (let i = s.length - 1; i > 0; i--) {
        if (s[i - 1].t <= rt) {
          const a = s[i - 1], b = s[i];
          const k = Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t || 1)));
          x = a.x + (b.x - a.x) * k;
          y = a.y + (b.y - a.y) * k;
          break;
        }
      }
      const dx = x - o.x, dist = Math.hypot(dx, y - o.y);
      o.moving = dist > 0.5;
      if (Math.abs(dx) > 0.5) o.face = dx > 0 ? 1 : -1;
      if (o.moving) o.walk += dt * 12;
      o.x = x;
      o.y = y;
    }
  }

  function updateCountdown(now) {
    const el = $('#countdown');
    if (!S.room || S.room.state === 'lobby') return el.classList.add('hidden');
    const left = S.countdownEnd - now;
    const shown = left > 0 ? Math.ceil(left / 1000) : (now < S.goUntil ? 0 : -1);
    if (shown !== S.lastBeep && shown >= 0) MR.Sfx.beep(shown === 0);
    S.lastBeep = shown;
    if (left > 0) {
      el.textContent = shown;
      el.classList.remove('hidden');
      S.goUntil = S.countdownEnd + 900;
    } else if (now < S.goUntil) {
      el.textContent = 'Set sail!';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (S.screen === 'game' && S.room) {
      updateMe(dt, now);
      updateOthers(dt, now);
      updateCountdown(now);

      const byId = new Map(S.room.players.map(p => [p.id, p]));
      const players = [];
      const meInfo = byId.get(S.myId);
      if (meInfo && !S.my.inHatch) {
        players.push({ ...S.me, name: meInfo.name, color: meInfo.color, status: meInfo.status, hat: meInfo.hat, eyes: meInfo.eyes, parrot: meInfo.parrot, team: meInfo.team, bubble: bubbleFor(S.myId, now), emote: emoteFor(S.myId, now, S.me.moving, false), isMe: true });
      }
      for (const [id, o] of S.others) {
        const info = byId.get(id);
        if (info && !o.hidden) {
          players.push({ x: o.x, y: o.y, face: o.face, walk: o.walk, moving: o.moving, name: info.name, color: info.color, status: info.status, hat: info.hat, eyes: info.eyes, parrot: info.parrot, team: info.team, bubble: bubbleFor(id, now), emote: emoteFor(id, now, o.moving, info.isBot) });
        }
      }
      if (S.room.state === 'lobby') {
        MR.Render.draw(canvas, {
          world: 'lobby', dpr, dt, me: S.me, players, time: now / 1000,
          sway: MR.Settings.get('sway'),
          showJoystick: !lobbyOpen(),
        });
        requestAnimationFrame(frame);
        return;
      }
      const playing = S.room.state === 'playing';
      const open = [];
      for (const t of S.tasks) {
        if (t.done) continue;
        const lockedLeft = Math.ceil((t.lockedUntil - now) / 1000);
        const full = t.coop && t.session && t.session.members.length >= 2 && !t.session.members.includes(S.myId);
        const st = { ...t, icon: typeInfo.get(t.type).icon, locked: lockedLeft > 0, lockedLeft, busy: !!(t.busyBy && t.busyBy !== S.myId) || full };
        open.push(st);
        if (t.coop && t.x2 != null) open.push({ ...st, x: t.x2, y: t.y2 }); // 🔑 the vault's second lock
      }
      const arrowTasks = open.filter(t => !t.busy)
        .sort((a, b) => Math.hypot(a.x - S.me.x, a.y - S.me.y) - Math.hypot(b.x - S.me.x, b.y - S.me.y))
        .slice(0, 6);
      // 🤝 Crewmates' calls get a green arrow. With task arrows off, only once you've said "On my way!".
      const helpArrows = playing && !S.mg ? S.calls
        .filter(c => c.callerId !== S.myId && (S.room.options.taskArrows || c.coming.includes(S.myId)))
        .map(c => ({ x: c.x, y: c.y, icon: '🤝', help: true })) : [];
      renderCoopBanner();
      MR.Render.draw(canvas, {
        dpr, dt, me: S.me, players, time: now / 1000,
        sway: MR.Settings.get('sway'),
        tasks: S.room.state === 'ended' ? [] : open,
        barrels: playing ? S.barrels : [],
        showHatches: playing && hasKey(now),
        inHatch: playing ? S.my.inHatch : null,
        fog: playing && now < S.my.fogUntil,
        storm: playing && now < S.my.stormUntil,
        shipEvent: playing ? S.event : null,
        showArrows: playing && !S.my.inHatch && (S.room.options.taskArrows || helpArrows.length > 0),
        arrowTasks: (S.room.options.taskArrows ? arrowTasks : []).concat(helpArrows),
        helpSpots: helpArrows,
        showJoystick: playing && !S.mg && !S.my.inHatch,
      });
      updateUseButton();
      updatePickupBtn(now);
      updateHatchPanel(now);
      updateEventBanner(now);
      if (S.my.inHatch && playing) drawHatchMap(now);
      if (!mapPanel.classList.contains('hidden')) drawShipMap(now, players);
      updateMapBtn(playing && now < S.my.fogUntil);
      // Keep anchor countdowns in the task list ticking.
      if (S.taskListOpen && now - lastListRefresh > 500 && S.tasks.some(t => t.lockedUntil > now - 1000)) {
        lastListRefresh = now;
        renderTaskList();
      }
    }
    requestAnimationFrame(frame);
  }

  let lastListRefresh = 0;
  let lastUseKey = '';
  function updateUseButton() {
    const a = S.mg ? null : useAction();
    const ready = !!a && a.kind !== 'locked';
    const key = `${a ? a.kind + a.icon : ''}|${S.room.state}|${!!S.my.inHatch}`;
    if (key === lastUseKey) return;
    lastUseKey = key;
    $('#useBtn').classList.toggle('ready', ready);
    $('#useIcon').textContent = a ? a.icon : '✋';
    $('#useBtn').classList.toggle('hidden', S.room.state === 'ended' || !!S.my.inHatch);
  }
  requestAnimationFrame(frame);
})();
