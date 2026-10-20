// How to Play: swipeable cards, each with a little animated picture drawn with the game's own art.
MR.HowTo = (() => {
  const R = () => MR.Render;
  const { items } = MR.Shared.pickups;
  const taskTypes = MR.Shared.tasks.types;
  const eventTypes = MR.Shared.events.types;
  const SEEN_KEY = 'mr.howtoSeen';
  const W = 300, H = 220; // every picture is drawn in this space, then scaled to fit

  const $ = s => document.querySelector(s);
  const el = $('#howto');
  const art = $('#howtoArt');
  const textEl = $('#howtoText');

  // ---------- little helpers for the pictures ----------
  function deck(g) {
    g.fillStyle = '#b07a45';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(60,30,10,.25)';
    g.lineWidth = 2;
    for (let y = 22; y < H; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    for (let y = 0, row = 0; y < H; y += 22, row++) {
      for (let x = (row % 2) * 60 + 30; x < W; x += 120) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 22); g.stroke(); }
    }
  }
  function pirate(g, x, y, color, t, extra = {}) {
    R().drawPirate(g, { x, y, color, face: 1, walk: t * 12, moving: false, name: '', hat: 'tricorn', eyes: 'patch', ...extra }, t);
  }
  function label(g, text, x, y, size = 15, color = '#fff') {
    g.save();
    g.font = `700 ${size}px Fredoka, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(30,15,5,.85)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.restore();
  }
  function emoji(g, ch, x, y, size) {
    g.save();
    g.font = `${size}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, x, y);
    g.restore();
  }
  function bar(g, x, y, w, frac, color) {
    g.fillStyle = 'rgba(30,15,5,.6)';
    g.fillRect(x - 2, y - 2, w + 4, 14);
    g.fillStyle = color;
    g.fillRect(x, y, w * Math.min(1, frac), 10);
  }
  const ease = k => k * k * (3 - 2 * k);
  const clamp01 = k => Math.max(0, Math.min(1, k));

  // ---------- the cards ----------
  const cards = [
    {
      title: '🏁 The Goal',
      html: `<p>Every pirate gets the <b>same number of tasks</b> on the ship.</p>
             <p>Be the <b>first</b> to finish all of yours and you win the race (and a parrot 🦜).</p>`,
      draw(g, t) {
        deck(g);
        const c = Math.min(1, (t % 5) / 3.4); // stops the moment the leader finishes
        const racers = [['#e74c3c', 1.0], ['#3498db', 0.82], ['#2ecc71', 0.7]];
        racers.forEach(([color, speed], i) => {
          const x = 60 + i * 90, done = c * speed >= 1;
          bar(g, x - 30, 52, 60, c * speed, done ? '#ffd23c' : '#7ddc6a');
          pirate(g, x, 140, color, t + i, { parrot: done && i === 0 });
          if (done && i === 0) emoji(g, '🏆', x, 24, 26);
        });
        label(g, 'Tasks done', W / 2, 205, 14);
      },
    },
    {
      title: '🕹️ Moving',
      html: `<p>Drag <b>anywhere on the left</b> to move with the joystick.</p>
             <p>Walk up to a glowing spot and the big <b>USE</b> button on the right lights up. Tap it!</p>`,
      draw(g, t) {
        deck(g);
        const a = t * 1.1;
        // Joystick
        g.fillStyle = 'rgba(255,255,255,.18)';
        g.strokeStyle = 'rgba(255,255,255,.6)';
        g.lineWidth = 3;
        g.beginPath(); g.arc(52, 160, 36, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.75)';
        g.beginPath(); g.arc(52 + Math.cos(a) * 20, 160 + Math.sin(a) * 20, 17, 0, Math.PI * 2); g.fill();
        // Pirate walking the same way
        const px = 160 + Math.cos(a) * 50, py = 100 + Math.sin(a) * 34;
        R().drawPirate(g, { x: px, y: py, color: '#e67e22', face: -Math.sin(a) >= 0 ? -1 : 1, walk: t * 12, moving: true, name: '', hat: 'tricorn', eyes: 'patch' }, t);
        // USE button
        const pulse = 1 + 0.06 * Math.sin(t * 6);
        g.save();
        g.translate(258, 168); g.scale(pulse, pulse);
        g.fillStyle = '#f2b632'; g.strokeStyle = '#a8761a'; g.lineWidth = 4;
        g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fill(); g.stroke();
        g.font = '700 16px Fredoka, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#3b2412';
        g.fillText('USE', 0, 1);
        g.restore();
      },
    },
    {
      title: '📋 Tasks',
      html: `<p>Each task is a quick <b>mini-game</b>, like tying ropes or loading a cannon.</p>
             <p>Tap <b>📋</b> (top left) for your list. Arrows point to your tasks if the Captain turned them on.</p>
             <div class="howto-icons">${taskTypes.map(x => `<span title="${x.name}">${x.icon}</span>`).join('')}</div>`,
      draw(g, t) {
        deck(g);
        const c = t % 4.5;
        const icon = taskTypes[Math.floor(t / 4.5) % taskTypes.length].icon;
        const walk = clamp01(c / 1.8);
        const done = c > 3.2;
        if (!done) R().drawStation(g, { x: 200, y: 150 }, icon, t);
        const px = 50 + ease(walk) * 100;
        R().drawPirate(g, { x: px, y: 150, color: '#9b59b6', face: 1, walk: t * 12, moving: walk < 1, name: '', hat: 'bandana', eyes: 'patch' }, t);
        if (c > 1.9 && !done) {
          bar(g, 160, 196, 80, (c - 1.9) / 1.3, '#7ddc6a');
        }
        if (done) emoji(g, '✅', 200, 110, 34);
      },
    },
    {
      title: '🛢️ Barrels & Items',
      html: `<p>Walk into a <b>? barrel</b> to grab a random item. You can hold one at a time.</p>
             <p>Tap the <b>item button</b> next to USE to use it: slow rivals, trap them, or speed yourself up.</p>
             <button id="howtoItems" class="btn btn-small howto-items-btn">📜 See all ${items.length} items</button>`,
      draw(g, t) {
        deck(g);
        const c = t % 4;
        const walk = clamp01(c / 1.5);
        const grabbed = c > 1.5;
        if (!grabbed) R().drawBarrel(g, { x: 210, y: 140, id: 1, kind: 'barrel' }, t);
        R().drawPirate(g, { x: 60 + ease(walk) * 120, y: 140, color: '#1abc9c', face: 1, walk: t * 12, moving: walk < 1, name: '', hat: 'skull', eyes: 'patch' }, t);
        if (grabbed) {
          const k = clamp01((c - 1.5) / 0.6);
          const item = items[Math.floor(t / 4) % items.length];
          g.save();
          g.globalAlpha = 1 - k * 0.4;
          for (let i = 0; i < 6; i++) {
            const ang = i * Math.PI / 3;
            g.fillStyle = 'rgba(255,240,200,.8)';
            g.beginPath(); g.arc(200 + Math.cos(ang) * 30 * k, 140 + Math.sin(ang) * 30 * k, 8 * (1 - k) + 2, 0, Math.PI * 2); g.fill();
          }
          g.restore();
          emoji(g, item.icon, 190, 90 - k * 20, 34);
          label(g, item.name, 190, 40, 15, '#ffd23c');
        }
      },
    },
    {
      title: '🗝️ Keys & Hatches',
      html: `<p>Golden <b>keys</b> sometimes appear on deck. Grab one to open the <b>smuggler's hatches</b>.</p>
             <p>Climb in, pick any glowing hatch on the map, and pop out there. A great shortcut!</p>`,
      draw(g, t) {
        deck(g);
        const c = t % 4;
        g.save();
        g.translate(0, 20);
        g.scale(0.8, 0.8);
        R().drawHatch(g, { x: 80, y: 170 }, t, false);
        R().drawHatch(g, { x: 300, y: 170 }, t, false);
        g.restore();
        // Dotted trip between the two hatches
        g.save();
        g.setLineDash([6, 8]);
        g.lineDashOffset = -t * 30;
        g.strokeStyle = 'rgba(255,210,60,.9)';
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(64, 140); g.quadraticCurveTo(152, 60, 240, 140); g.stroke();
        g.restore();
        g.save(); g.translate(150, 30); g.scale(0.55, 0.55); R().drawKey(g, { x: 0, y: 0, id: 2 }, t); g.restore();
        // Pirate: drop in, travel, pop out
        let x, s;
        if (c < 1.2) { x = 64; s = 1 - clamp01((c - 0.6) / 0.6); }
        else if (c < 2.2) { x = null; }
        else { x = 240; s = clamp01((c - 2.2) / 0.5); }
        if (x !== null && s > 0) {
          g.save();
          g.translate(x, 120); g.scale(s, s);
          pirate(g, 0, 0, '#e74c3c', t);
          g.restore();
        } else if (x === null) {
          const k = (c - 1.2) / 1.0;
          const bx = 64 + (240 - 64) * k, by = (1 - k) * (1 - k) * 140 + 2 * (1 - k) * k * 60 + k * k * 140;
          g.save();
          g.shadowColor = '#ffd23c'; g.shadowBlur = 16;
          g.fillStyle = '#e74c3c';
          g.beginPath(); g.arc(bx, by, 10, 0, Math.PI * 2); g.fill();
          g.restore();
        }
      },
    },
    {
      title: '🌊 Ship Events',
      html: `<p>If the Captain turns on events, the sea gets wild. You get a warning first!</p>
             <ul class="howto-list">${eventTypes.map(e => `<li><span>${e.icon}</span><span><b>${e.name}:</b> ${{
               kraken: 'octopuses block some doorways. Find another way round.',
               wave: 'a big wave pushes everyone across the deck.',
               eclipse: 'the ship goes dark. You can only see around you.',
             }[e.id] || e.desc}</span></li>`).join('')}</ul>`,
      draw(g, t) {
        deck(g);
        g.fillStyle = '#5a3519';
        g.fillRect(170, 0, 26, 62);
        g.fillRect(170, 178, 26, 42);
        R().drawOctopus(g, 183, 120, 112, true, t);
        const bump = Math.abs(Math.sin(t * 2.2));
        pirate(g, 80 + bump * 30, 128, '#3498db', t);
        if (bump > 0.9) emoji(g, '❗', 110, 70, 22);
      },
    },
    {
      title: '👥 Team Mode',
      html: `<p>In <b>Teams</b>, two crews race. Your crew <b>shares one task list</b>, so split up and cover the ship.</p>
             <p><b>🤝 Co-op tasks</b> need two crewmates: ⛵ hold the sail together, 🪣 take turns pumping, 🏦 turn the vault's two keys in time. Start one and your crew gets a call: tap <b>On my way!</b></p>
             <p>Items never hit your own crew.</p>`,
      draw(g, t) {
        deck(g);
        const c = (t % 5) / 4;
        bar(g, 30, 30, 100, c * 0.95, '#ff4d4d');
        bar(g, 170, 30, 100, c * 0.8, '#3fa9ff');
        label(g, 'Red crew', 80, 62, 14, '#ff8a8a');
        label(g, 'Blue crew', 220, 62, 14, '#8ccfff');
        pirate(g, 55, 140, '#e74c3c', t, { team: 'red' });
        pirate(g, 110, 160, '#f1c40f', t + 1, { team: 'red', hat: 'straw' });
        pirate(g, 190, 160, '#9b59b6', t + 2, { team: 'blue', hat: 'beanie' });
        pirate(g, 245, 140, '#1abc9c', t + 3, { team: 'blue', hat: 'captain' });
      },
    },
    {
      title: '⚓ The Lobby',
      html: `<p>While you wait, <b>walk around</b> the Captain's Quarters and chat with 💬.</p>
             <p>Tap <b>⚓ Crew &amp; Options</b> to pick your color and look, or see the game options. Share the <b>room code</b> (top right) with friends.</p>
             <p>The Captain taps <b>⛵ Set Sail!</b> to start.</p>`,
      draw(g, t) {
        deck(g);
        g.fillStyle = '#8e2a22';
        g.fillRect(40, 30, 220, 160);
        g.strokeStyle = '#d4a017'; g.lineWidth = 3;
        g.strokeRect(48, 38, 204, 144);
        R().drawHelm(g, 150, 112, 64, t);
        // Pirates strolling round the wheel, nearest drawn last
        ['#e74c3c', '#3498db', '#2ecc71']
          .map((color, i) => {
            const a = t * 0.6 + i * (Math.PI * 2 / 3);
            return { a, color, i, x: 150 + Math.cos(a) * 104, y: 118 + Math.sin(a) * 58 };
          })
          .sort((p, q) => p.y - q.y)
          .forEach(({ a, color, i, x, y }) => {
            R().drawPirate(g, { x, y, color, face: -Math.sin(a) >= 0 ? 1 : -1, walk: t * 12, moving: true, name: '', hat: ['tricorn', 'bandana', 'captain'][i], eyes: 'patch' }, t);
          });
      },
    },
  ];

  // ---------- the item list (from card 4) ----------
  const TARGET = { player: 'On a rival', all: 'All rivals', self: 'On you', passive: 'Hold it' };
  function itemsHtml() {
    return `<button id="howtoItemsBack" class="btn btn-small">◀ Back</button>
      <ul class="howto-items">${items.map(it => `<li><span class="hi-icon">${it.icon}</span>
        <span><b>${it.name}</b> <i>${TARGET[it.target] || ''}</i><br>${it.desc}</span></li>`).join('')}</ul>`;
  }

  // ---------- showing it ----------
  let index = 0, showingItems = false, raf = 0;

  function render() {
    const card = cards[index];
    el.classList.toggle('items-view', showingItems);
    $('#howtoTitle').textContent = showingItems ? '📜 All items' : card.title;
    textEl.innerHTML = showingItems ? itemsHtml() : card.html;
    textEl.scrollTop = 0;
    $('#howtoDots').replaceChildren(...cards.map((_, i) => {
      const d = document.createElement('button');
      d.className = 'howto-dot' + (i === index ? ' on' : '');
      d.setAttribute('aria-label', `Card ${i + 1}: ${cards[i].title}`);
      d.addEventListener('click', () => go(i));
      return d;
    }));
    $('#howtoPrev').disabled = index === 0;
    $('#howtoNext').textContent = index === cards.length - 1 ? "Let's go! ⚓" : 'Next ▶';
    const itemsBtn = $('#howtoItems');
    if (itemsBtn) itemsBtn.addEventListener('click', () => { showingItems = true; render(); });
    const back = $('#howtoItemsBack');
    if (back) back.addEventListener('click', () => { showingItems = false; render(); });
  }

  function go(i) {
    index = Math.max(0, Math.min(cards.length - 1, i));
    showingItems = false;
    render();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (showingItems) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(art.clientWidth * dpr), ch = Math.round(art.clientHeight * dpr);
    if (!cw || !ch) return;
    if (art.width !== cw || art.height !== ch) { art.width = cw; art.height = ch; }
    const g = art.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const k = Math.min(cw / W, ch / H);
    g.translate((cw - W * k) / 2, (ch - H * k) / 2);
    g.scale(k, k);
    g.beginPath(); g.rect(0, 0, W, H); g.clip();
    cards[index].draw(g, now / 1000);
  }

  function open(at = 0) {
    if (MR.Input) MR.Input.reset();
    go(at);
    el.classList.remove('hidden');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }
  function close() {
    el.classList.add('hidden');
    cancelAnimationFrame(raf);
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* private mode: just show it again next time */ }
  }
  const isOpen = () => !el.classList.contains('hidden');

  $('#howtoClose').addEventListener('click', close);
  $('#howtoPrev').addEventListener('click', () => go(index - 1));
  $('#howtoNext').addEventListener('click', () => (index === cards.length - 1 ? close() : go(index + 1)));
  el.addEventListener('click', e => { if (e.target === el) close(); });
  document.querySelectorAll('.howto-open').forEach(b => b.addEventListener('click', () => open(0)));
  document.addEventListener('keydown', e => {
    if (!isOpen() || showingItems) return;
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'Escape') close();
  });

  // Swipe left / right on the card
  let swipeX = null, swipeY = 0;
  const body = $('#howtoBody');
  body.addEventListener('touchstart', e => { swipeX = e.touches[0].clientX; swipeY = e.touches[0].clientY; }, { passive: true });
  body.addEventListener('touchend', e => {
    if (swipeX === null || showingItems) return;
    const dx = e.changedTouches[0].clientX - swipeX, dy = e.changedTouches[0].clientY - swipeY;
    swipeX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
  });

  // First visit: show it once, on the home screen.
  function firstVisit() {
    let seen = false;
    try { seen = !!localStorage.getItem(SEEN_KEY); } catch (e) { seen = false; }
    if (!seen && $('#home').classList.contains('active')) open(0);
  }

  setTimeout(firstVisit, 400);

  return { open, close, isOpen, cards };
})();
