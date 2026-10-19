const map = require('../shared/map');
const physics = require('../shared/physics');
const tasksDef = require('../shared/tasks');
const pickupsDef = require('../shared/pickups');
const { assign, pickTypes } = require('./taskAssign');

const MAX_PLAYERS = 6;
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
const RECONNECT_GRACE_MS = 45000;

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
const pick = list => list[Math.floor(Math.random() * list.length)];

class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.players = new Map();
    this.hostId = null;
    this.state = 'lobby'; // lobby | countdown | playing | ended
    this.winnerId = null;
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
    this.options = { taskArrows: true, taskCount: tasksDef.DEFAULT_TASKS };
  }

  joinError() {
    if (this.state !== 'lobby') return 'That game has already started.';
    if (this.players.size >= MAX_PLAYERS) return 'That room is full.';
    return null;
  }

  // id: stable player id (survives reconnects). socketId: the current connection. token: secret used to rejoin.
  addPlayer(id, socketId, token, name) {
    const used = new Set([...this.players.values()].map(p => p.color));
    const color = COLORS.find(c => !used.has(c));
    const p = {
      id, socketId, token, connected: true, dropTimer: null,
      name, color, x: map.spawn.x, y: map.spawn.y, budget: BUDGET_CAP, lastMoveAt: 0, tasks: [],
    };
    this.resetPlayer(p);
    this.players.set(id, p);
    if (!this.hostId) this.hostId = id;
    this.broadcast();
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
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    clearTimeout(p.dropTimer);
    this.players.delete(id);
    if (this.hostId === id) {
      const list = [...this.players.values()];
      this.hostId = (list.find(q => q.connected) || list[0] || {}).id || null;
    }
    if (this.players.size === 0) {
      this.stopTimers();
      if (this.onEmpty) this.onEmpty();
    } else {
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
    p.activeTask = null;
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
    if (this.state === 'lobby') return;
    this.sendTasks(p);
    this.sendMe(p);
    this.toPlayer(p, 'barrels', this.barrels);
    this.toPlayer(p, 'correct', { x: p.x, y: p.y });
    if (this.state === 'countdown') this.toPlayer(p, 'countdown', { ms: Math.max(0, this.countdownEndsAt - Date.now()) });
  }

  // Private message to one player (skipped while they're offline).
  toPlayer(p, ev, data) {
    if (p.connected && p.socketId) this.io.to(p.socketId).emit(ev, data);
  }

  isEmpty() {
    return this.players.size === 0;
  }

  setOption(byId, key, value) {
    if (byId !== this.hostId || this.state !== 'lobby') return;
    // Each option only accepts sensible values.
    const valid = {
      taskArrows: v => typeof v === 'boolean',
      taskCount: v => Number.isInteger(v) && v >= tasksDef.MIN_TASKS && v <= tasksDef.MAX_TASKS,
    };
    if (!valid[key] || !valid[key](value)) return;
    this.options[key] = value;
    this.broadcast();
  }

  setColor(id, color) {
    const p = this.players.get(id);
    if (!p || this.state !== 'lobby' || !COLORS.includes(color)) return;
    for (const other of this.players.values()) if (other.id !== id && other.color === color) return;
    p.color = color;
    this.broadcast();
  }

  // ---------------- match flow ----------------

  start(byId) {
    if (byId !== this.hostId || this.state !== 'lobby') return;
    const list = [...this.players.values()];
    // Same random set of task types for everyone this round.
    const assigned = assign(list.length, pickTypes(this.options.taskCount));
    list.forEach((p, i) => {
      const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      p.x = map.spawn.x + Math.cos(a) * map.spawn.r;
      p.y = map.spawn.y + Math.sin(a) * map.spawn.r;
      p.budget = BUDGET_CAP;
      this.resetPlayer(p);
      p.tasks = assigned[i].map(s => ({
        type: s.type, stationId: s.id, x: s.x, y: s.y, area: areaAt(s.x, s.y).name, done: false, lockedUntil: 0,
      }));
    });
    this.winnerId = null;
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
      this.broadcast();
      this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    }, COUNTDOWN_MS);
  }

  backToLobby(byId) {
    if (byId !== this.hostId || this.state === 'lobby') return;
    this.stopTimers();
    this.state = 'lobby';
    this.winnerId = null;
    this.barrels = [];
    for (const p of this.players.values()) {
      p.tasks = [];
      this.resetPlayer(p);
    }
    this.broadcast();
  }

  end(winnerId) {
    this.stopTimers();
    this.state = 'ended';
    this.winnerId = winnerId;
    for (const p of this.players.values()) {
      p.activeTask = null;
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
      // Re-send the room when anyone's status icons change (e.g. slime wore off).
      const status = JSON.stringify([...this.players.values()].map(p => this.statusOf(p, now)));
      if (status !== this.lastStatus) this.broadcast();
    }
    const p = [...this.players.values()].map(pl => [pl.id, Math.round(pl.x), Math.round(pl.y), pl.inHatch ? 1 : 0]);
    this.io.to(this.code).emit('state', { p });
  }

  // ---------------- movement ----------------

  // Client reports where it moved; the server checks speed and walls, and corrects if needed.
  handleMove(id, x, y) {
    if (this.state !== 'playing') return;
    const p = this.players.get(id);
    if (!p || !Number.isFinite(x) || !Number.isFinite(y)) return;

    const now = Date.now();
    // Storm gusts can push you a bit faster than normal, so allow for them too.
    const speedMul = pickupsDef.speedMul(now < p.slowUntil, now < p.boostUntil) + (now < p.stormUntil ? pickupsDef.STORM_DRIFT : 0);
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
    const res = physics.sweep(p.x, p.y, p.x + dx, p.y + dy);
    p.budget -= Math.hypot(res.x - p.x, res.y - p.y);
    p.x = res.x;
    p.y = res.y;

    // Walking away cancels a task in progress.
    if (p.activeTask) {
      const t = p.tasks.find(tk => tk.type === p.activeTask.type);
      if (dist(t, p) > tasksDef.USE_DIST + SLACK) p.activeTask = null;
    }

    if (Math.hypot(res.x - x, res.y - y) > 4) {
      this.toPlayer(p, 'correct', { x: res.x, y: res.y });
    }
  }

  // ---------------- tasks ----------------

  startTask(id, type) {
    const p = this.players.get(id);
    if (!p || this.state !== 'playing') return { error: 'The game is not running.' };
    if (p.inHatch) return { error: 'Climb out of the hatch first.' };
    if (Date.now() < p.netUntil) return { error: NETTED };
    const t = p.tasks.find(tk => tk.type === type);
    if (!t || t.done) return { error: 'That task is not available.' };
    if (Date.now() < t.lockedUntil) return { error: '⚓ That task is anchored! Wait for the chain to fall off.' };
    if (dist(t, p) > tasksDef.USE_DIST + SLACK) return { error: 'Get closer to the station.' };
    p.activeTask = { type, startedAt: Date.now() };
    const scramble = p.scramble;
    if (scramble) {
      p.scramble = false;
      this.sendMe(p);
    }
    return { error: null, scramble };
  }

  completeTask(id, type) {
    const p = this.players.get(id);
    if (!p || this.state !== 'playing') return 'The game is not running.';
    if (!p.activeTask || p.activeTask.type !== type) return 'That task was interrupted.';
    if (Date.now() - p.activeTask.startedAt < typeById.get(type).minMs) return 'Too fast!';
    const t = p.tasks.find(tk => tk.type === type);
    t.done = true;
    p.activeTask = null;
    this.sendTasks(p);
    if (p.tasks.every(tk => tk.done)) this.end(p.id);
    else this.broadcast();
    return null;
  }

  cancelTask(id) {
    const p = this.players.get(id);
    if (p) p.activeTask = null;
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
    const leader = Math.max(...[...this.players.values()].map(q => this.doneCount(q)));
    const weights = leader - this.doneCount(p) >= 2 ? CATCHUP_WEIGHTS : WEIGHTS;
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
        if (q === p || this.targetError(q, item.id, now)) continue;
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
        this.sendTasks(q);
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
        this.sendTasks(q);
        break;
      }
    }
    // Getting sabotaged knocks you out of your mini-game (the parrot waits for the next one).
    if (item !== 'parrot' && q.activeTask) {
      q.activeTask = null;
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
    p.activeTask = null;
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

  // Each player only learns where their own tasks are. Timers are sent as "ms left".
  sendTasks(p) {
    const now = Date.now();
    this.toPlayer(p, 'tasks', p.tasks.map(t => ({
      type: t.type, stationId: t.stationId, x: t.x, y: t.y, area: t.area, done: t.done,
      lockedMs: Math.max(0, t.lockedUntil - now),
    })));
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
      colors: COLORS,
      options: this.options,
      taskCount: this.options.taskCount,
      players: players.map(p => ({
        id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, connected: p.connected,
        done: this.doneCount(p),
        status: this.statusOf(p, now),
        // Why each sabotage can't target this player (for the target picker).
        blocked: Object.fromEntries(['anchor', 'slime', 'parrot', 'wave', 'net'].map(i => [i, this.targetError(p, i, now)])),
      })),
    });
  }

  stopTimers() {
    for (const p of this.players.values()) if (!p.connected) clearTimeout(p.dropTimer);
    clearTimeout(this.countdownTimer);
    clearInterval(this.tickTimer);
    this.countdownTimer = null;
    this.tickTimer = null;
  }
}

module.exports = Room;
