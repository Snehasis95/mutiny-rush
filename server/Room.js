const map = require('../shared/map');
const physics = require('../shared/physics');
const tasksDef = require('../shared/tasks');
const pickupsDef = require('../shared/pickups');
const { assign, pickTypes } = require('./taskAssign');
const bots = require('./bots');
const coop = require('./coop');
const eventsDef = require('../shared/events');
const looks = require('../shared/looks');
const lobbyMap = require('../shared/lobbyMap');
const lobbyPhysics = physics.create(lobbyMap); // walking around the lobby room

const MAX_PLAYERS = 6;
const TEAMS = ['red', 'blue'];
const TEAM_MAX = 3;
const COUNTDOWN_MS = 3000;
const TICK_MS = 50; // 20 updates per second
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#e67e22', '#9b59b6', '#ff6fae', '#1abc9c'];
const SLACK = 40; // extra distance allowed on the server for network lag

// Barrels and sabotage
const BARREL_EVERY_MS = 6000;
const BARREL_MAX = 6;
const BARRELS_AT_START = 3;
// Smuggler's Keys lie on the deck in plain sight (not inside barrels)
const KEY_FIRST_MS = 8000;
const KEY_EVERY_MS = 20000;
const KEY_MAX = 2;
const IMMUNE_MS = 10000;
const ANCHOR_MS = 15000;
const SLOW_MS = 8000;
const FOG_MS = 10000;
const BOOST_MS = 6000;
const STORM_MS = 8000;
const RUM_MS = 8000;
const NET_MS = 6000;
const KEY_MS = 30000;
const KEY_TRIPS = 3;
const HATCH_MAX_MS = 5000;
// A player whose connection drops is kept this long so they can rejoin.
// (tests shorten this with the MR_RECONNECT_GRACE_MS environment variable)
const RECONNECT_GRACE_MS = Number(process.env.MR_RECONNECT_GRACE_MS) || 45000;

// Drop weights. Players who are behind get better odds of the strong ones.
const WEIGHTS = { anchor: 18, slime: 18, parrot: 18, rum: 16, net: 12, wind: 14, alarm: 10, fog: 10, coin: 10, storm: 8, wave: 2 };
const CATCHUP_WEIGHTS = { ...WEIGHTS, fog: 14, storm: 12, wave: 7 };

// Movement budget: lets a client move at most ~SPEED, with a little slack for network jitter.
const BUDGET_RATE = physics.SPEED * 1.3;
const BUDGET_CAP = physics.SPEED * 0.6;

const typeById = new Map(tasksDef.types.map(t => [t.id, t]));
const itemById = new Map(pickupsDef.items.map(i => [i.id, i]));
const hatchById = new Map(map.hatches.map(h => [h.id, h]));
const areaAt = (x, y) => map.areas.find(a => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const NETTED = "🥅 You're tangled in a net!";
// Chat
const CHAT_MAX_LEN = 120;
const CHAT_HISTORY = 30;
const CHAT_BURST = 5;          // at most this many messages...
const CHAT_WINDOW_MS = 5000;   // ...in this many milliseconds
const pick = list => list[Math.floor(Math.random() * list.length)];

class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.players = new Map();
    this.hostId = null;
    this.state = 'lobby'; // lobby | countdown | playing | ended
    this.winnerId = null;
    this.winnerTeam = null;
    this.teamTasks = null; // team mode: { red: [...], blue: [...] } shared by teammates
    this.countdownTimer = null;
    this.countdownEndsAt = 0;
    this.tickTimer = null;
    this.onEmpty = null; // set by the server: called when the last player is gone
    this.barrels = [];
    this.barrelSeq = 0;
    this.nextBarrelAt = 0;
    this.nextKeyAt = 0;
    this.lastStatus = '';
    // Options the room creator can change in the lobby
    this.options = { taskArrows: true, taskCount: tasksDef.DEFAULT_TASKS, botCount: 0, botLevel: 'normal', events: true, mode: 'solo' };
    this.botSeq = 0;
    // Random ship events
    this.event = null;      // { id, phase: 'warning' | 'active', startsAt, endsAt, data }
    this.lastEventId = null;
    this.nextEventAt = 0;
    this.blockers = [];     // temporary walls (Kraken tentacles)
    this.lobbyTimer = null;
    this.startLobbyTimer();
    this.chatLog = []; // recent messages, sent to people who join or reconnect
  }

  humans() {
    return [...this.players.values()].filter(p => !p.isBot);
  }

  // ---------------- teams ----------------

  teamMode() {
    return this.options.mode === 'team';
  }

  teamMembers(team) {
    return [...this.players.values()].filter(p => p.team === team);
  }

  // The team with fewer pirates (red on a tie).
  smallerTeam() {
    return TEAMS.slice().sort((a, b) => this.teamMembers(a).length - this.teamMembers(b).length)[0];
  }

  sameTeam(a, b) {
    return this.teamMode() && a.team && a.team === b.team;
  }

  // Split everyone as evenly as possible (people first, so bots fill the gaps).
  balanceTeams() {
    let list = [...this.players.values()];
    list = list.filter(p => !p.isBot).concat(list.filter(p => p.isBot));
    for (const p of list) p.team = null;
    list.forEach((p, i) => { p.team = TEAMS[i % 2]; });
  }

  setTeam(id, team) {
    const p = this.players.get(id);
    if (!p || this.state !== 'lobby' || !this.teamMode() || !TEAMS.includes(team) || p.team === team) return;
    if (this.teamMembers(team).length >= TEAM_MAX) {
      // Full team: swap places with one of its bots if there is one.
      const bot = this.teamMembers(team).find(q => q.isBot);
      if (!bot) return;
      bot.team = p.team;
    }
    p.team = team;
    this.broadcast();
  }

  // Captain picks the crews: send a pirate to the other crew. If that crew is full,
  // they swap with `swapWithId` (the Captain's pick) or else with one of its bots.
  moveToTeam(byId, id, swapWithId) {
    const p = this.players.get(id);
    if (byId !== this.hostId || this.state !== 'lobby' || !this.teamMode() || !p || !p.team) return 'Not allowed';
    const to = p.team === TEAMS[0] ? TEAMS[1] : TEAMS[0];
    const members = this.teamMembers(to);
    const other = swapWithId ? members.find(q => q.id === swapWithId) : null;
    if (swapWithId && !other) return 'Not in that crew';
    if (other) other.team = p.team;
    else if (members.length >= TEAM_MAX) {
      const bot = members.find(q => q.isBot);
      if (!bot) return 'That crew is full';
      bot.team = p.team;
    }
    p.team = to;
    this.broadcast();
    return null;
  }

  // Random crews, not balanced (the Captain evens them out with the arrows). Crews still hold 3.
  shuffleTeams(byId) {
    if (byId !== this.hostId || this.state !== 'lobby' || !this.teamMode()) return;
    const count = { [TEAMS[0]]: 0, [TEAMS[1]]: 0 };
    for (const p of this.players.values()) {
      let team = TEAMS[Math.floor(Math.random() * 2)];
      if (count[team] >= TEAM_MAX) team = team === TEAMS[0] ? TEAMS[1] : TEAMS[0];
      p.team = team;
      count[team]++;
    }
    this.broadcast();
  }

  // The tasks this player can work on: their own (solo) or their crew's (teams).
  taskById(p, key) {
    return p.tasks.find(t => t.id === key) || (!this.teamMode() && p.tasks.find(t => t.type === key)) || null;
  }

  // Someone stops doing a task (finished, cancelled, knocked out...): free it for teammates.
  clearActive(p) {
    if (!p.activeTask) return;
    const t = p.tasks.find(tk => tk.id === p.activeTask.taskId);
    p.activeTask = null;
    if (t && t.coop) coop.leave(this, p, t, Date.now()); // the crewmate keeps waiting
    else if (t && t.busyBy === p.id) t.busyBy = null;
  }

  // Keep the number of bots in line with the Captain's choice, leaving seats free for people.
  syncBots() {
    if (this.state !== 'lobby') return;
    const want = Math.max(0, Math.min(this.options.botCount, MAX_PLAYERS - this.humans().length));
    const have = [...this.players.values()].filter(p => p.isBot);
    for (const b of have.slice(want)) this.players.delete(b.id);
    for (let i = have.length; i < want; i++) {
      const used = new Set([...this.players.values()].map(p => p.name));
      const name = bots.NAMES.map(n => '🤖 ' + n).find(n => !used.has(n)) || '🤖 Bot ' + (this.botSeq + 1);
      this.addPlayer('bot-' + ++this.botSeq, null, null, name, true, looks.random());
    }
  }

  joinError() {
    if (this.state !== 'lobby') return 'That game has already started.';
    // Bots step aside for people, so only count humans here.
    if (this.humans().length >= MAX_PLAYERS) return 'That room is full.';
    return null;
  }

  // id: stable player id (survives reconnects). socketId: the current connection. token: secret used to rejoin.
  addPlayer(id, socketId, token, name, isBot = false, look = null) {
    const used = new Set([...this.players.values()].map(p => p.color));
    const color = COLORS.find(c => !used.has(c));
    const p = {
      id, socketId, token, isBot, connected: true, dropTimer: null,
      name, color, x: map.spawn.x, y: map.spawn.y, budget: BUDGET_CAP, lastMoveAt: 0, tasks: [],
      ...looks.clean(look),
      parrot: false, // 🦜 the last winner in this room
      team: null,
    };
    this.resetPlayer(p);
    if (!isBot && this.humans().length + [...this.players.values()].filter(q => q.isBot).length >= MAX_PLAYERS) {
      // Room is full of bots: one of them gives up its seat.
      const bot = [...this.players.values()].reverse().find(q => q.isBot);
      if (bot) this.players.delete(bot.id);
    }
    if (this.teamMode()) p.team = this.smallerTeam();
    if (this.state === 'lobby') Object.assign(p, this.lobbySpot());
    this.players.set(id, p);
    if (!this.hostId && !isBot) this.hostId = id;
    if (!isBot) {
      this.broadcast();
      this.toPlayer(p, 'chatHistory', this.chatLog);
    }
  }

  // Clears everything that belongs to a single match.
  resetPlayer(p) {
    p.activeTask = null;
    p.pickup = null;
    p.slowUntil = 0;
    p.immuneUntil = 0;
    p.fogUntil = 0;
    p.boostUntil = 0;
    p.stormUntil = 0;
    p.rumUntil = 0;
    p.netUntil = 0;
    p.shield = false;
    p.scramble = false;
    p.keyUntil = 0;
    p.keyTrips = 0;
    p.inHatch = null;
    p.hatchAt = 0;
    if (p.isBot) bots.resetBrain(p);
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    clearTimeout(p.dropTimer);
    this.players.delete(id);
    const humans = this.humans();
    if (this.hostId === id) {
      this.hostId = (humans.find(q => q.connected) || humans[0] || {}).id || null;
    }
    if (humans.length === 0) {
      // Only bots left: close the room.
      this.players.clear();
      this.stopTimers();
      if (this.onEmpty) this.onEmpty();
    } else {
      this.syncBots(); // a freed seat can go back to a bot
      this.broadcast();
    }
  }

  findByToken(token) {
    return [...this.players.values()].find(p => p.token === token) || null;
  }

  // Connection dropped: keep the pirate for a while so they can come back.
  disconnectPlayer(id, socketId) {
    const p = this.players.get(id);
    if (!p || p.socketId !== socketId) return; // an older connection; the player already moved on
    p.connected = false;
    p.socketId = null;
    this.clearActive(p);
    if (p.inHatch) this.exitHatch(id);
    clearTimeout(p.dropTimer);
    p.dropTimer = setTimeout(() => this.removePlayer(id), RECONNECT_GRACE_MS);
    this.broadcast();
  }

  // Same player, new connection: pick up exactly where they left off.
  reconnectPlayer(p, socketId) {
    clearTimeout(p.dropTimer);
    p.dropTimer = null;
    p.socketId = socketId;
    p.connected = true;
    p.lastMoveAt = Date.now();
    p.budget = BUDGET_CAP;
    this.broadcast();
    this.toPlayer(p, 'chatHistory', this.chatLog);
    if (this.state === 'lobby') return;
    this.sendTasks(p);
    this.sendMe(p);
    this.toPlayer(p, 'barrels', this.barrels);
    this.toPlayer(p, 'correct', { x: p.x, y: p.y });
    if (this.state === 'countdown') this.toPlayer(p, 'countdown', { ms: Math.max(0, this.countdownEndsAt - Date.now()) });
    if (this.event) this.toPlayer(p, 'event', this.eventPayload(Date.now()));
    if (this.teamTasks && p.team) this.toPlayer(p, 'coopCalls', coop.callsFor(this, p.team));
  }

  // Private message to one player (skipped while they're offline).
  toPlayer(p, ev, data) {
    if (p.connected && p.socketId) this.io.to(p.socketId).emit(ev, data);
  }

  isEmpty() {
    return this.humans().length === 0;
  }

  setOption(byId, key, value) {
    if (byId !== this.hostId || this.state !== 'lobby') return;
    // Each option only accepts sensible values.
    const valid = {
      taskArrows: v => typeof v === 'boolean',
      taskCount: v => Number.isInteger(v) && v >= tasksDef.MIN_TASKS && v <= tasksDef.MAX_TASKS,
      botCount: v => Number.isInteger(v) && v >= 0 && v <= MAX_PLAYERS - 1,
      botLevel: v => bots.LEVEL_IDS.includes(v),
      events: v => typeof v === 'boolean',
      mode: v => v === 'solo' || v === 'team',
    };
    if (!valid[key] || !valid[key](value)) return;
    this.options[key] = value;
    if (key === 'botCount') this.syncBots();
    if (key === 'mode') {
      if (value === 'team') this.balanceTeams();
      else for (const p of this.players.values()) p.team = null;
    }
    this.broadcast();
  }

  setLook(id, look) {
    const p = this.players.get(id);
    if (!p || this.state !== 'lobby') return;
    Object.assign(p, looks.clean(look));
    this.broadcast();
  }

  setColor(id, color) {
    const p = this.players.get(id);
    if (!p || this.state !== 'lobby' || !COLORS.includes(color)) return;
    const owner = [...this.players.values()].find(o => o.id !== id && o.color === color);
    if (owner && !owner.isBot) return;
    if (owner) {
      const used = new Set([...this.players.values()].map(o => o.color));
      owner.color = COLORS.find(c => !used.has(c)) || p.color;
    }
    p.color = color;
    this.broadcast();
  }

  // ---------------- match flow ----------------

  start(byId) {
    if (byId !== this.hostId || this.state !== 'lobby') return;
    const list = [...this.players.values()];
    if (this.teamMode() && TEAMS.some(t => !this.teamMembers(t).length)) {
      const host = this.players.get(byId);
      this.toPlayer(host, 'notice', { text: 'Each crew needs at least one pirate (add a bot or move someone).' });
      return;
    }
    // Same random set of task types for everyone this round.
    const assigned = assign(list.length, pickTypes(this.options.taskCount));
    const makeTask = (s, owner) => ({
      id: `${owner}:${s.type}`, type: s.type, stationId: s.id, x: s.x, y: s.y, area: areaAt(s.x, s.y).name,
      done: false, lockedUntil: 0, busyBy: null, doneBy: null,
    });
    this.teamTasks = this.teamMode() ? { red: [], blue: [] } : null;
    list.forEach((p, i) => {
      const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      p.x = map.spawn.x + Math.cos(a) * map.spawn.r;
      p.y = map.spawn.y + Math.sin(a) * map.spawn.r;
      p.budget = BUDGET_CAP;
      this.resetPlayer(p);
      const mine = assigned[i].map(s => makeTask(s, p.id));
      if (this.teamTasks) this.teamTasks[p.team].push(...mine);
      else p.tasks = mine;
    });
    // Teammates all point at the same shared list (tasks per player x team size), with 🤝 co-op tasks mixed in.
    if (this.teamTasks) {
      coop.addTasks(this);
      for (const p of list) p.tasks = this.teamTasks[p.team];
    }
    this.winnerId = null;
    this.winnerTeam = null;
    this.barrels = [];
    this.state = 'countdown';
    this.broadcast();
    this.sendBarrels();
    for (const p of list) {
      this.sendTasks(p);
      this.sendMe(p);
    }
    this.countdownEndsAt = Date.now() + COUNTDOWN_MS;
    this.io.to(this.code).emit('countdown', { ms: COUNTDOWN_MS });
    this.countdownTimer = setTimeout(() => {
      this.state = 'playing';
      const now = Date.now();
      for (const p of this.players.values()) p.lastMoveAt = now;
      for (let i = 0; i < BARRELS_AT_START; i++) this.spawnBarrel();
      this.nextBarrelAt = now + BARREL_EVERY_MS;
      this.nextKeyAt = now + KEY_FIRST_MS;
      this.event = null;
      this.blockers = [];
      this.nextEventAt = now + eventsDef.FIRST_MS;
      this.broadcast();
      this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    }, COUNTDOWN_MS);
  }

  backToLobby(byId) {
    if (byId !== this.hostId || this.state === 'lobby') return;
    this.stopTimers();
    this.clearEvent();
    this.state = 'lobby';
    this.winnerId = null;
    this.winnerTeam = null;
    this.teamTasks = null;
    this.barrels = [];
    for (const p of this.players.values()) {
      p.tasks = [];
      this.resetPlayer(p);
    }
    this.syncBots(); // seats freed during the game go back to bots
    for (const p of this.players.values()) {
      Object.assign(p, this.lobbySpot());
      p.budget = BUDGET_CAP;
      this.toPlayer(p, 'correct', { x: p.x, y: p.y });
    }
    this.startLobbyTimer();
    this.broadcast();
  }

  end(winnerId) {
    this.stopTimers();
    this.clearEvent();
    const winner = this.players.get(winnerId);
    this.winnerTeam = this.teamMode() && winner ? winner.team : null;
    for (const p of this.players.values()) {
      p.parrot = this.winnerTeam ? p.team === this.winnerTeam : p.id === winnerId; // 🦜 for every winner
    }
    this.state = 'ended';
    this.winnerId = winnerId;
    // Race over: co-op calls just stop (no "left the task" messages).
    for (const list of Object.values(this.teamTasks || {})) for (const t of list) t.session = null;
    for (const p of this.players.values()) {
      this.clearActive(p);
      p.inHatch = null;
    }
    this.tick(); // final positions
    this.broadcast();
  }

  tick() {
    const now = Date.now();
    if (this.state === 'playing') {
      if (now >= this.nextBarrelAt) {
        this.spawnBarrel();
        this.nextBarrelAt = now + BARREL_EVERY_MS;
      }
      if (now >= this.nextKeyAt) {
        this.spawnBarrel('key');
        this.nextKeyAt = now + KEY_EVERY_MS;
      }
      for (const p of this.players.values()) {
        // Key runs out: you get pushed out of any hatch and the slot frees up.
        if (p.pickup === 'key' && now >= p.keyUntil) {
          if (p.inHatch) this.exitHatch(p.id);
          p.pickup = null;
          this.sendMe(p);
        }
        if (p.inHatch && now - p.hatchAt > HATCH_MAX_MS) {
          this.exitHatch(p.id);
          this.toPlayer(p, 'notice', { text: 'Too long in the hatch, you got pushed out!' });
        }
      }
      this.updateEvent(now);
      coop.tick(this, now, TICK_MS / 1000);
      for (const p of this.players.values()) {
        if (p.isBot && this.state === 'playing') bots.update(this, p, TICK_MS / 1000, now);
      }
      // Re-send the room when anyone's status icons change (e.g. slime wore off).
      const status = JSON.stringify([...this.players.values()].map(p => this.statusOf(p, now)));
      if (status !== this.lastStatus) this.broadcast();
    }
    const p = [...this.players.values()].map(pl => [pl.id, Math.round(pl.x), Math.round(pl.y), pl.inHatch ? 1 : 0]);
    this.io.to(this.code).emit('state', { p });
  }

  // ---------------- random ship events ----------------

  updateEvent(now) {
    if (!this.options.events) return;
    const ev = this.event;
    if (!ev) {
      if (now >= this.nextEventAt) this.warnEvent(now);
    } else if (ev.phase === 'warning' && now >= ev.startsAt) {
      this.startEvent(now);
    } else if (ev.phase === 'active' && now >= ev.endsAt) {
      this.clearEvent();
      this.nextEventAt = now + eventsDef.GAP_MS[0] + Math.random() * (eventsDef.GAP_MS[1] - eventsDef.GAP_MS[0]);
    }
  }

  // Step 1: announce it (3 seconds of warning).
  warnEvent(now) {
    const choices = eventsDef.types.filter(t => t.id !== this.lastEventId);
    const type = pick(choices);
    const data = {};
    if (type.id === 'kraken') {
      data.doors = this.pickKrakenDoors();
      data.rects = data.doors.map(eventsDef.tentacleRect);
    }
    if (type.id === 'wave') {
      // Sweeps along the length or the width of the ship
      data.dir = pick([{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]);
    }
    this.event = { id: type.id, phase: 'warning', startsAt: now + eventsDef.WARNING_MS, endsAt: now + eventsDef.WARNING_MS + type.ms, data };
    this.lastEventId = type.id;
    this.io.to(this.code).emit('event', this.eventPayload(now));
  }

  // Step 2: it hits.
  startEvent(now) {
    const ev = this.event;
    ev.phase = 'active';
    if (ev.id === 'kraken') {
      this.blockers = ev.data.rects;
      // Anyone standing in a doorway gets shoved clear of the tentacle.
      for (const p of this.players.values()) {
        if (p.inHatch) continue;
        const r = physics.resolve(p.x, p.y, this.blockers);
        if (Math.hypot(r.x - p.x, r.y - p.y) > 0.5) {
          p.x = r.x;
          p.y = r.y;
          this.toPlayer(p, 'correct', { x: p.x, y: p.y });
        }
        if (p.isBot) bots.resetPath(p);
      }
    }
    if (ev.id === 'wave') {
      // The wave knocks everyone out of their mini-game.
      for (const p of this.players.values()) {
        if (!p.activeTask || p.inHatch) continue;
        this.clearActive(p);
        this.toPlayer(p, 'interrupt');
      }
    }
    this.io.to(this.code).emit('event', this.eventPayload(now));
  }

  clearEvent() {
    if (!this.event) return;
    this.event = null;
    this.blockers = [];
    for (const p of this.players.values()) if (p.isBot) bots.resetPath(p);
    this.io.to(this.code).emit('event', { phase: 'end' });
  }

  waveDir() {
    const ev = this.event;
    return ev && ev.id === 'wave' && ev.phase === 'active' ? ev.data.dir : null;
  }

  eventPayload(now) {
    const ev = this.event;
    return {
      id: ev.id,
      phase: ev.phase,
      ms: Math.max(0, (ev.phase === 'warning' ? ev.startsAt : ev.endsAt) - now),
      data: ev.data,
    };
  }

  // Blocks some doorways spread around the ship, but every room keeps a way out
  // and the ship stays connected.
  pickKrakenDoors() {
    const doors = map.doors;
    const side = d => (d.x < 900 ? 'left' : d.x > 1500 ? 'right' : 'middle');
    for (let tries = 0; tries < 200; tries++) {
      // Proper (Fisher-Yates) shuffle so every doorway has the same chance
      const order = doors.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const chosen = order.slice(0, eventsDef.KRAKEN_DOORS);
      // Not all on one side of the ship
      if (new Set(chosen.map(side)).size < 2) continue;
      const open = doors.filter(d => !chosen.includes(d));
      const seen = new Set(['deck']);
      const queue = ['deck'];
      while (queue.length) {
        const a = queue.shift();
        for (const d of open) {
          const other = d.a === a ? d.b : d.b === a ? d.a : null;
          if (other && !seen.has(other)) { seen.add(other); queue.push(other); }
        }
      }
      if (seen.size === map.areas.length) return chosen;
    }
    return [];
  }

  // ---------------- chat ----------------

  // Returns an error message, or null when the message was sent.
  chat(id, text) {
    const p = this.players.get(id);
    if (!p || p.isBot) return 'Not in a room.';
    if (typeof text !== 'string') return 'Nothing to send.';
    // One line, no control characters, trimmed and capped.
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
    if (!clean) return 'Nothing to send.';
    const now = Date.now();
    p.chatTimes = (p.chatTimes || []).filter(t => now - t < CHAT_WINDOW_MS);
    if (p.chatTimes.length >= CHAT_BURST) return 'Slow down, matey! Wait a moment.';
    p.chatTimes.push(now);
    const msg = { id: p.id, name: p.name, color: p.color, team: p.team, text: clean, t: now };
    this.chatLog.push(msg);
    if (this.chatLog.length > CHAT_HISTORY) this.chatLog.shift();
    this.io.to(this.code).emit('chat', msg);
    return null;
  }

  // ---------------- lobby room ----------------

  // A free spot near the wheel for someone arriving in the lobby.
  lobbySpot() {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 110;
      const x = lobbyMap.spawn.x + Math.cos(a) * r, y = lobbyMap.spawn.y + Math.sin(a) * r * 0.75;
      const res = lobbyPhysics.resolve(x, y);
      if (Math.hypot(res.x - x, res.y - y) < 0.5) return { x, y };
    }
    return { x: lobbyMap.spawn.x, y: lobbyMap.spawn.y + lobbyMap.spawn.r };
  }

  handleLobbyMove(id, x, y) {
    const p = this.players.get(id);
    if (!p || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = Date.now();
    p.budget = Math.min(BUDGET_CAP, p.budget + (BUDGET_RATE * (now - p.lastMoveAt)) / 1000);
    p.lastMoveAt = now;
    let dx = x - p.x, dy = y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > p.budget) { dx *= p.budget / d; dy *= p.budget / d; }
    const res = lobbyPhysics.sweep(p.x, p.y, p.x + dx, p.y + dy);
    p.budget -= Math.hypot(res.x - p.x, res.y - p.y);
    p.x = res.x;
    p.y = res.y;
    if (Math.hypot(res.x - x, res.y - y) > 4) this.toPlayer(p, 'correct', { x: res.x, y: res.y });
  }

  // While in the lobby: bots stroll around and everyone's position is shared.
  startLobbyTimer() {
    if (this.lobbyTimer) return;
    this.lobbyTimer = setInterval(() => this.lobbyTick(), TICK_MS);
    if (this.lobbyTimer.unref) this.lobbyTimer.unref();
  }

  lobbyTick() {
    if (this.state !== 'lobby') return;
    const now = Date.now();
    for (const p of this.players.values()) {
      if (p.isBot) bots.wanderLobby(p, TICK_MS / 1000, now, lobbyPhysics, lobbyMap);
    }
    const p = [...this.players.values()].map(pl => [pl.id, Math.round(pl.x), Math.round(pl.y), 0]);
    this.io.to(this.code).emit('state', { p });
  }

  // ---------------- movement ----------------

  // Client reports where it moved; the server checks speed and walls, and corrects if needed.
  handleMove(id, x, y) {
    if (this.state === 'lobby') return this.handleLobbyMove(id, x, y);
    if (this.state !== 'playing') return;
    const p = this.players.get(id);
    if (!p || !Number.isFinite(x) || !Number.isFinite(y)) return;

    const now = Date.now();
    // Storm gusts can push you a bit faster than normal, so allow for them too.
    const speedMul = pickupsDef.speedMul(now < p.slowUntil, now < p.boostUntil) + (now < p.stormUntil ? pickupsDef.STORM_DRIFT : 0)
      + (this.waveDir() ? eventsDef.WAVE_PUSH : 0);
    p.budget = Math.min(BUDGET_CAP * Math.max(1, speedMul), p.budget + (BUDGET_RATE * speedMul * (now - p.lastMoveAt)) / 1000);
    p.lastMoveAt = now;

    // Inside a hatch or tangled in a net: you stay where you are.
    if (p.inHatch || now < p.netUntil) {
      this.toPlayer(p, 'correct', { x: p.x, y: p.y });
      return;
    }

    let dx = x - p.x, dy = y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > p.budget) {
      dx *= p.budget / d;
      dy *= p.budget / d;
    }
    const res = physics.sweep(p.x, p.y, p.x + dx, p.y + dy, this.blockers);
    p.budget -= Math.hypot(res.x - p.x, res.y - p.y);
    p.x = res.x;
    p.y = res.y;

    // Walking away cancels a task in progress.
    if (p.activeTask) {
      const t = this.taskById(p, p.activeTask.taskId);
      const spot = t && t.coop ? coop.spotOf(t, p) : t;
      if (!t || dist(spot, p) > tasksDef.USE_DIST + SLACK) this.clearActive(p);
    }

    if (Math.hypot(res.x - x, res.y - y) > 4) {
      this.toPlayer(p, 'correct', { x: res.x, y: res.y });
    }
  }

  // ---------------- tasks ----------------

  // taskKey: the task's id (a task type also works in solo games).
  startTask(id, taskKey) {
    const p = this.players.get(id);
    if (!p || this.state !== 'playing') return { error: 'The game is not running.' };
    if (p.inHatch) return { error: 'Climb out of the hatch first.' };
    if (Date.now() < p.netUntil) return { error: NETTED };
    const t = this.taskById(p, taskKey);
    if (!t || t.done) return { error: 'That task is not available.' };
    if (Date.now() < t.lockedUntil) return { error: '⚓ That task is anchored! Wait for the chain to fall off.' };
    if (t.coop) {
      // 🤝 Call the crew, or join the crewmate who's waiting.
      if (p.activeTask && p.activeTask.taskId !== t.id) this.clearActive(p);
      const error = coop.start(this, p, t, Date.now());
      return { error, coop: !error };
    }
    if (dist(t, p) > tasksDef.USE_DIST + SLACK) return { error: 'Get closer to the station.' };
    const other = t.busyBy && t.busyBy !== id && this.players.get(t.busyBy);
    if (other && other.activeTask && other.activeTask.taskId === t.id) return { error: `${other.name} is already on it!` };
    this.clearActive(p);
    t.busyBy = id;
    p.activeTask = { taskId: t.id, type: t.type, startedAt: Date.now() };
    this.sendTeamTasks(p);
    const scramble = p.scramble;
    if (scramble) {
      p.scramble = false;
      this.sendMe(p);
    }
    return { error: null, scramble };
  }

  completeTask(id, taskKey) {
    const p = this.players.get(id);
    if (!p || this.state !== 'playing') return 'The game is not running.';
    const t = this.taskById(p, taskKey);
    if (!p.activeTask || !t || p.activeTask.taskId !== t.id) return 'That task was interrupted.';
    if (t.coop) return 'Co-op tasks finish when you both do your part.';
    if (Date.now() - p.activeTask.startedAt < typeById.get(t.type).minMs) return 'Too fast!';
    t.done = true;
    t.doneBy = id;
    this.clearActive(p);
    this.sendTeamTasks(p);
    if (p.tasks.every(tk => tk.done)) this.end(p.id);
    else this.broadcast();
    return null;
  }

  cancelTask(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.clearActive(p);
    this.sendTeamTasks(p);
  }

  // 🤝 Taps inside a co-op mini-game (hold / pump / turn).
  coopInput(id, data) {
    const p = this.players.get(id);
    if (!p || this.state !== 'playing') return 'The game is not running.';
    return coop.input(this, p, data, Date.now());
  }

  // 🤝 "On my way!" / "Go anyway" / cancel.
  coopReply(id, taskId, action) {
    const p = this.players.get(id);
    if (!p || this.state !== 'playing' || !this.teamMode()) return 'The game is not running.';
    return coop.reply(this, p, taskId, action);
  }

  // ---------------- barrels + keys ----------------
  // this.barrels holds both: { id, x, y, kind: 'barrel' | 'key' }

  spawnBarrel(kind = 'barrel') {
    const count = this.barrels.filter(b => b.kind === kind).length;
    if (count >= (kind === 'key' ? KEY_MAX : BARREL_MAX)) return;
    const players = [...this.players.values()];
    const free = map.barrelSpots.filter(s =>
      !this.barrels.some(b => dist(b, s) < 50) && !players.some(p => dist(p, s) < 120));
    if (!free.length) return;
    const spot = pick(free);
    this.barrels.push({ id: ++this.barrelSeq, x: spot.x, y: spot.y, kind });
    this.sendBarrels();
  }

  rollItem(p) {
    const progress = q => (q.tasks.length ? this.doneCount(q) / q.tasks.length : 0);
    const leader = Math.max(...[...this.players.values()].map(progress));
    const weights = leader - progress(p) >= 0.3 ? CATCHUP_WEIGHTS : WEIGHTS;
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const [id, w] of Object.entries(weights)) {
      if ((r -= w) < 0) return id;
    }
    return 'anchor';
  }

  grabBarrel(id, barrelId) {
    const p = this.players.get(id);
    if (!p || this.state !== 'playing') return { error: 'The game is not running.' };
    if (p.inHatch) return { error: 'Climb out of the hatch first.' };
    if (Date.now() < p.netUntil) return { error: NETTED };
    if (p.pickup) return { error: 'Your hands are full! Use your item first.' };
    const b = this.barrels.find(br => br.id === barrelId);
    if (!b) return { error: 'Someone grabbed it first!' };
    if (dist(b, p) > pickupsDef.GRAB_DIST + SLACK) return { error: b.kind === 'key' ? 'Get closer to the key.' : 'Get closer to the barrel.' };

    this.barrels = this.barrels.filter(br => br !== b);
    const item = b.kind === 'key' ? 'key' : this.rollItem(p);
    p.pickup = item;
    if (item === 'key') {
      p.keyUntil = Date.now() + KEY_MS;
      p.keyTrips = KEY_TRIPS;
    }
    this.sendBarrels();
    this.sendMe(p);
    this.broadcast();
    return { error: null, item };
  }

  // ---------------- sabotage ----------------

  // Why a sabotage can't target this player right now (null = it can).
  targetError(q, item, now) {
    if (!q.connected) return 'Offline';
    if (q.inHatch) return 'Hidden in a hatch';
    if (now < q.immuneUntil) return 'Immune right now';
    if (item === 'anchor' && !q.tasks.some(t => !t.done && now >= t.lockedUntil)) return 'No task to anchor';
    if (item === 'wave') {
      const done = this.doneCount(q);
      if (done === 0) return 'No finished tasks';
      if (done >= q.tasks.length - 1) return 'Too close to winning';
    }
    return null;
  }

  usePickup(id, targetId) {
    const p = this.players.get(id);
    if (!p || this.state !== 'playing') return 'The game is not running.';
    if (p.inHatch) return 'Climb out of the hatch first.';
    const item = p.pickup && itemById.get(p.pickup);
    if (!item || item.target === 'passive') return 'Nothing to use.';
    const now = Date.now();

    if (item.target === 'self') {
      if (item.id === 'coin') p.shield = true;
      if (item.id === 'wind') p.boostUntil = now + BOOST_MS;
      p.pickup = null;
      this.sendMe(p);
      this.feed({ by: p.id, item: item.id });
      this.broadcast();
      return null;
    }

    if (item.target === 'all') {
      p.pickup = null;
      for (const q of this.players.values()) {
        if (q === p || this.sameTeam(p, q) || this.targetError(q, item.id, now)) continue;
        // The alarm only bothers rivals who are in the middle of a task.
        if (item.id === 'alarm' && !q.activeTask) continue;
        this.hit(p, q, item.id, now);
      }
      this.sendMe(p);
      this.feed({ by: p.id, item: item.id });
      this.broadcast();
      return null;
    }

    const q = this.players.get(targetId);
    if (!q || q === p) return 'Pick a rival.';
    if (this.sameTeam(p, q)) return "That's your crewmate!";
    const err = this.targetError(q, item.id, now);
    if (err) return err;
    p.pickup = null;
    const blocked = this.hit(p, q, item.id, now);
    this.sendMe(p);
    this.feed({ by: p.id, target: q.id, item: item.id, blocked });
    this.broadcast();
    return null;
  }

  // Applies one sabotage to q. Returns true if q's Lucky Coin blocked it.
  hit(p, q, item, now) {
    if (q.shield) {
      q.shield = false;
      this.sendMe(q);
      const it = itemById.get(item);
      if (it.target === 'all') this.toPlayer(q, 'notice', { text: `🛡️ Your Lucky Coin blocked ${p.name}'s ${it.name}!` });
      return true;
    }
    q.immuneUntil = now + IMMUNE_MS;
    switch (item) {
      case 'anchor': {
        const t = pick(q.tasks.filter(tk => !tk.done && now >= tk.lockedUntil));
        t.lockedUntil = now + ANCHOR_MS;
        for (const wid of coop.workers(t)) {
          const b = this.players.get(wid);
          if (b) { this.clearActive(b); this.toPlayer(b, 'interrupt'); }
        }
        this.sendTeamTasks(q);
        break;
      }
      case 'slime':
        q.slowUntil = now + SLOW_MS;
        break;
      case 'parrot':
        q.scramble = true;
        break;
      case 'fog':
        q.fogUntil = now + FOG_MS;
        break;
      case 'storm':
        q.stormUntil = now + STORM_MS;
        break;
      case 'rum':
        q.rumUntil = now + RUM_MS;
        break;
      case 'net':
        q.netUntil = now + NET_MS;
        break;
      case 'alarm':
        break; // the interrupt below is the whole effect
      case 'wave': {
        const t = pick(q.tasks.filter(tk => tk.done));
        t.done = false;
        t.doneBy = null;
        this.sendTeamTasks(q);
        break;
      }
    }
    // Getting sabotaged knocks you out of your mini-game (the parrot waits for the next one).
    if (item !== 'parrot' && q.activeTask) {
      this.clearActive(q);
      this.toPlayer(q, 'interrupt');
    }
    this.sendMe(q);
    return false;
  }

  // ---------------- hatches ----------------

  hasKey(p, now = Date.now()) {
    return p.pickup === 'key' && now < p.keyUntil;
  }

  enterHatch(id, hatchId) {
    const p = this.players.get(id);
    const h = hatchById.get(hatchId);
    if (!p || this.state !== 'playing') return 'The game is not running.';
    if (!this.hasKey(p)) return 'You need the Smuggler\'s Key.';
    if (Date.now() < p.netUntil) return NETTED;
    if (p.inHatch) return 'Already inside.';
    if (!h || dist(h, p) > pickupsDef.HATCH_DIST + SLACK) return 'Stand on the hatch.';
    if (p.keyTrips <= 0) return 'Your key is worn out.';
    this.clearActive(p);
    p.inHatch = h.id;
    p.hatchAt = Date.now();
    p.x = h.x;
    p.y = h.y;
    this.toPlayer(p, 'correct', { x: p.x, y: p.y });
    this.sendMe(p);
    this.broadcast();
    return null;
  }

  travelHatch(id, toId) {
    const p = this.players.get(id);
    if (!p || !p.inHatch) return 'You are not in a hatch.';
    const from = hatchById.get(p.inHatch), to = hatchById.get(toId);
    if (!to || to.net !== from.net || to === from) return 'That hatch is not connected.';
    if (p.keyTrips <= 0) return 'Your key is worn out.';
    p.keyTrips--;
    p.inHatch = to.id;
    p.hatchAt = Date.now();
    p.x = to.x;
    p.y = to.y;
    this.toPlayer(p, 'correct', { x: p.x, y: p.y });
    this.sendMe(p);
    return null;
  }

  exitHatch(id) {
    const p = this.players.get(id);
    if (!p || !p.inHatch) return 'You are not in a hatch.';
    p.inHatch = null;
    p.budget = BUDGET_CAP;
    p.lastMoveAt = Date.now();
    // Dust puff + creak, so nearby pirates notice.
    this.io.to(this.code).emit('fx', { kind: 'puff', x: p.x, y: p.y });
    // A key with no trips left is used up once you climb out.
    if (p.keyTrips <= 0 && p.pickup === 'key') p.pickup = null;
    this.sendMe(p);
    this.broadcast();
    return null;
  }

  // ---------------- messages ----------------

  doneCount(p) {
    return p.tasks.filter(t => t.done).length;
  }

  // Public status icons shown next to each player.
  statusOf(p, now) {
    const s = [];
    if (!p.connected) s.push('offline');
    if (p.tasks.some(t => !t.done && now < t.lockedUntil)) s.push('anchor');
    if (now < p.slowUntil) s.push('slime');
    if (p.scramble) s.push('parrot');
    if (now < p.fogUntil) s.push('fog');
    if (now < p.stormUntil) s.push('storm');
    if (now < p.rumUntil) s.push('rum');
    if (now < p.netUntil) s.push('net');
    if (now < p.boostUntil) s.push('wind');
    if (p.shield) s.push('coin');
    if (this.hasKey(p, now)) s.push('key');
    if (now < p.immuneUntil) s.push('immune');
    return s;
  }

  feed(data) {
    this.io.to(this.code).emit('fx', { kind: 'sabotage', ...data });
  }

  sendBarrels() {
    this.io.to(this.code).emit('barrels', this.barrels);
  }

  // Each player only learns where their own (or their crew's) tasks are. Timers are sent as "ms left".
  sendTasks(p) {
    const now = Date.now();
    this.toPlayer(p, 'tasks', p.tasks.map(t => ({
      id: t.id, type: t.type, stationId: t.stationId, x: t.x, y: t.y, area: t.area, done: t.done,
      lockedMs: Math.max(0, t.lockedUntil - now), busyBy: t.busyBy, doneBy: t.doneBy,
      ...coop.taskFields(t),
    })));
  }

  // Same, for everyone who shares this task list.
  sendTeamTasks(p) {
    if (!this.teamMode() || !p.team) return this.sendTasks(p);
    for (const q of this.teamMembers(p.team)) this.sendTasks(q);
  }

  sendMe(p) {
    const now = Date.now();
    const left = t => Math.max(0, t - now);
    this.toPlayer(p, 'me', {
      pickup: p.pickup,
      slowMs: left(p.slowUntil),
      fogMs: left(p.fogUntil),
      boostMs: left(p.boostUntil),
      stormMs: left(p.stormUntil),
      rumMs: left(p.rumUntil),
      netMs: left(p.netUntil),
      immuneMs: left(p.immuneUntil),
      keyMs: p.pickup === 'key' ? left(p.keyUntil) : 0,
      keyTrips: p.keyTrips,
      shield: p.shield,
      scramble: p.scramble,
      inHatch: p.inHatch,
    });
  }

  broadcast() {
    const now = Date.now();
    const players = [...this.players.values()];
    this.lastStatus = JSON.stringify(players.map(p => this.statusOf(p, now)));
    this.io.to(this.code).emit('room', {
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      winnerId: this.winnerId,
      winnerTeam: this.winnerTeam,
      teams: this.teamMode() ? Object.fromEntries(TEAMS.map(t => {
        const list = (this.teamTasks && this.teamTasks[t]) || [];
        return [t, { done: list.filter(x => x.done).length, total: list.length }];
      })) : null,
      colors: COLORS,
      options: this.options,
      taskCount: this.options.taskCount,
      players: players.map(p => ({
        id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, connected: p.connected, isBot: !!p.isBot,
        hat: p.hat, eyes: p.eyes, parrot: p.parrot, team: p.team,
        done: this.doneCount(p),
        status: this.statusOf(p, now),
        // Why each sabotage can't target this player (for the target picker).
        blocked: Object.fromEntries(['anchor', 'slime', 'parrot', 'wave', 'net'].map(i => [i, this.targetError(p, i, now)])),
      })),
    });
  }

  stopTimers() {
    for (const p of this.players.values()) if (!p.connected) clearTimeout(p.dropTimer);
    clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
    clearTimeout(this.countdownTimer);
    clearInterval(this.tickTimer);
    this.countdownTimer = null;
    this.tickTimer = null;
  }
}

module.exports = Room;
