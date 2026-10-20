// Computer-controlled pirates. They live on the server and play by the same rules as people:
// they walk (around walls) to their tasks, take a realistic time to do them, grab barrels
// near their route and throw items at whoever is winning.
const map = require('../shared/map');
const physics = require('../shared/physics');
const tasksDef = require('../shared/tasks');
const pickupsDef = require('../shared/pickups');
const eventsDef = require('../shared/events');
const coop = require('./coop');

const NAMES = ['Blackbeard', 'Anne Bonny', 'Calico Jack', 'Long John', 'Barbossa', 'Mad Morgan', 'Flint', 'Davy Jones', 'Mary Read', 'Red Rackham'];

const rand = (a, b) => a + Math.random() * (b - a);

// How each difficulty plays. Normal is the original bot.
const LEVELS = {
  easy: {
    walk: 0.7,              // share of full walking speed
    taskExtra: [5000, 9000], // extra ms spent on each mini-game
    pause: [1000, 2500],    // "thinking" pause after each task
    barrelReach: 220,       // only detours for barrels this close
    itemDelay: [4000, 9000],
    leaderChance: 0.3,      // how often they aim at whoever is winning
    coopAnswer: 3000,       // 🤝 how long before answering a crewmate's call
    coopAct: [700, 1200],   // reaction time inside a co-op task (pump, turn, hold)
  },
  normal: {
    walk: 1, taskExtra: [2500, 6000], pause: [0, 0], barrelReach: 380, itemDelay: [1500, 5000], leaderChance: 0.7,
    coopAnswer: 1500, coopAct: [350, 700],
  },
  hard: {
    walk: 1, taskExtra: [1000, 3000], pause: [0, 0], barrelReach: 520, itemDelay: [600, 2000], leaderChance: 1,
    coopAnswer: 300, coopAct: [150, 350],
  },
};
const COOP_WAIT_MS = 20000; // a bot waiting for help gives up after this long with nobody coming
const COOP_SKIP_MS = 15000; // ...and leaves co-op tasks alone for a while
const LEVEL_IDS = Object.keys(LEVELS);
const levelOf = room => LEVELS[room.options.botLevel] || LEVELS.normal;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const typeById = new Map(tasksDef.types.map(t => [t.id, t]));
const itemById = new Map(pickupsDef.items.map(i => [i.id, i]));

// ---------------- walking grid + route finding ----------------
const CELL = 20;
const COLS = Math.ceil(map.W / CELL);
const ROWS = Math.ceil(map.H / CELL);
const walkable = new Uint8Array(COLS * ROWS);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
    const p = physics.resolve(x, y);
    // Walkable if a pirate can stand here without being pushed (plus a little margin).
    const q = physics.resolve(x + 3, y + 3);
    walkable[r * COLS + c] = Math.hypot(p.x - x, p.y - y) < 0.5 && Math.hypot(q.x - x - 3, q.y - y - 3) < 0.5 ? 1 : 0;
  }
}
const cellOf = (x, y) => ({ c: Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL))), r: Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL))) });
const isWalk = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && walkable[r * COLS + c] === 1;
const centre = (c, r) => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 });

// Closest walkable cell to a point (targets like task stations sit right next to furniture).
function nearestWalkable(x, y) {
  const s = cellOf(x, y);
  if (isWalk(s.c, s.r)) return s;
  for (let rad = 1; rad < 12; rad++) {
    let best = null, bestD = Infinity;
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad || !isWalk(s.c + dc, s.r + dr)) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD) { bestD = d; best = { c: s.c + dc, r: s.r + dr }; }
      }
    }
    if (best) return best;
  }
  return null;
}

// Straight walk between two points without touching anything?
function clearLine(a, b, ok = isWalk) {
  const steps = Math.ceil(dist(a, b) / 8);
  for (let i = 1; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps, y = a.y + ((b.y - a.y) * i) / steps;
    const c = cellOf(x, y);
    if (!ok(c.c, c.r)) return false;
  }
  return true;
}

// A* over the grid (8 directions), then the path is straightened where there's a clear line.
function findPath(from, to, blockers = []) {
  const R = physics.PLAYER_R + 4;
  const blocked = (c, r) => {
    if (!blockers.length) return false;
    const x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
    return blockers.some(b => x > b.x - R && x < b.x + b.w + R && y > b.y - R && y < b.y + b.h + R);
  };
  const ok = (c, r) => isWalk(c, r) && !blocked(c, r);
  const s = nearestWalkable(from.x, from.y), g = nearestWalkable(to.x, to.y);
  if (!s || !g) return null;
  const key = (c, r) => r * COLS + c;
  const startK = key(s.c, s.r), goalK = key(g.c, g.r);
  const gScore = new Map([[startK, 0]]);
  const came = new Map();
  const open = [{ k: startK, c: s.c, r: s.r, f: 0 }];
  const closed = new Set();
  const h = (c, r) => Math.hypot(c - g.c, r - g.r);
  while (open.length) {
    // Small grid: a simple "pick the lowest" open list is fast enough.
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.k === goalK) break;
    if (closed.has(cur.k)) continue;
    closed.add(cur.k);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cur.c + dc, nr = cur.r + dr;
        if (!ok(nc, nr)) continue;
        if (dr && dc && (!ok(cur.c + dc, cur.r) || !ok(cur.c, cur.r + dr))) continue; // no corner cutting
        const nk = key(nc, nr);
        const ng = gScore.get(cur.k) + (dr && dc ? 1.414 : 1);
        if (ng < (gScore.has(nk) ? gScore.get(nk) : Infinity)) {
          gScore.set(nk, ng);
          came.set(nk, cur.k);
          open.push({ k: nk, c: nc, r: nr, f: ng + h(nc, nr) });
        }
      }
    }
  }
  if (!came.has(goalK) && startK !== goalK) return null;
  const cells = [];
  for (let k = goalK; k !== undefined; k = came.get(k)) {
    cells.push(centre(k % COLS, Math.floor(k / COLS)));
    if (k === startK) break;
  }
  cells.reverse();
  cells.push({ x: to.x, y: to.y });
  // Straighten: from each point jump to the furthest one we can walk to directly.
  const out = [];
  let i = 0, here = { x: from.x, y: from.y };
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !clearLine(here, cells[j], ok)) j--;
    out.push(cells[j]);
    here = cells[j];
    i = j + 1;
  }
  return out;
}

// ---------------- the bot's brain ----------------
function brain(p) {
  if (!p.brain) p.brain = { goal: null, path: null, taskUntil: 0, itemAt: 0, restUntil: 0, checkAt: 0, checkX: 0, checkY: 0, wobble: rand(0, 6) };
  return p.brain;
}

function resetBrain(p) {
  p.brain = null;
}

// In the lobby room: stroll to a random spot, look around for a bit, repeat.
function wanderLobby(p, dt, now, ph, room) {
  const w = p.lobbyWalk || (p.lobbyWalk = { target: null, restUntil: now + rand(500, 2500), checkAt: 0, checkX: 0, checkY: 0 });
  if (now < w.restUntil) return;
  if (!w.target) {
    const a = rand(0, Math.PI * 2), r = rand(110, 240);
    w.target = { x: room.spawn.x + Math.cos(a) * r, y: room.spawn.y + Math.sin(a) * r * 0.7 };
  }
  const dx = w.target.x - p.x, dy = w.target.y - p.y, d = Math.hypot(dx, dy);
  if (d < 12) {
    w.target = null;
    w.restUntil = now + rand(1500, 4500);
    return;
  }
  const res = ph.move(p.x, p.y, dx / d, dy / d, dt, 0.45);
  p.x = res.x;
  p.y = res.y;
  // Bumped into the wheel or furniture: pick somewhere else.
  if (now >= w.checkAt) {
    if (w.checkAt && Math.hypot(p.x - w.checkX, p.y - w.checkY) < 5) w.target = null;
    w.checkAt = now + 1000;
    w.checkX = p.x;
    w.checkY = p.y;
  }
}

// Forget the current route (e.g. tentacles just appeared or went away).
function resetPath(p) {
  if (p.brain) p.brain.path = null;
}

// Where a bot should stand for a co-op task it is starting: the nearest lock
// (a crew of one with the vault: the lock that isn't turned yet).
function coopSpot(p, t) {
  const locks = t.x2 == null ? [{ x: t.x, y: t.y, i: 0 }] : [{ x: t.x, y: t.y, i: 0 }, { x: t.x2, y: t.y2, i: 1 }];
  const open = locks.filter(l => !(t.turned && t.turned[l.i]));
  return (open.length ? open : locks).sort((a, b) => dist(p, a) - dist(p, b))[0];
}

// Where should this bot go next? The nearest open task, or a barrel that's close by.
// 🤝 Co-op tasks wait until the bot has nothing else to do.
function chooseGoal(room, p, now) {
  const b = brain(p);
  // Tasks a crewmate bot is already walking to are left for them.
  const claimed = new Set([...room.players.values()]
    .filter(q => q !== p && q.isBot && q.brain && q.brain.goal && q.brain.goal.kind === 'task' && q.tasks === p.tasks)
    .map(q => q.brain.goal.id));
  const open = p.tasks.filter(t => !t.done && now >= t.lockedUntil && !claimed.has(t.id) && (!t.busyBy || t.busyBy === p.id));
  let tasks = open.filter(t => !t.coop);
  // One co-op task at a time per crew, or two bots could each wait for the other forever.
  const crewOnCoop = p.tasks.some(t => t.coop && t.session) || [...room.players.values()]
    .some(q => q !== p && q.tasks === p.tasks && q.brain && q.brain.goal && (q.brain.goal.coop || q.brain.goal.kind === 'coop'));
  if (!tasks.length && !crewOnCoop && now >= (b.coopSkipUntil || 0)) {
    tasks = open.filter(t => t.coop && !t.session).map(t => ({ ...coopSpot(p, t), id: t.id, type: t.type, coop: true }));
  }
  const nearestTask = tasks.sort((a, c) => dist(p, a) - dist(p, c))[0];
  if (!p.pickup) {
    const barrel = room.barrels
      .filter(b => b.kind === 'barrel')
      .sort((a, b) => dist(p, a) - dist(p, b))[0];
    const taskD = nearestTask ? dist(p, nearestTask) : Infinity;
    if (barrel && dist(p, barrel) < levelOf(room).barrelReach && dist(p, barrel) < taskD * 0.9) {
      return { kind: 'barrel', id: barrel.id, x: barrel.x, y: barrel.y };
    }
  }
  if (nearestTask) return { kind: 'task', id: nearestTask.id, type: nearestTask.type, x: nearestTask.x, y: nearestTask.y, coop: !!nearestTask.coop };
  // Every task is anchored: drift towards the middle and wait.
  return { kind: 'wait', x: map.spawn.x + rand(-150, 150), y: map.spawn.y + rand(-80, 80) };
}

function goalStillValid(room, p, g, now) {
  if (g.kind === 'barrel') return !p.pickup && room.barrels.some(b => b.id === g.id);
  if (g.kind === 'task') {
    const t = p.tasks.find(tk => tk.id === g.id);
    return t && !t.done && now >= t.lockedUntil && (!t.busyBy || t.busyBy === p.id) && !(t.coop && t.session);
  }
  if (g.kind === 'coop') {
    // On the way to help: still needed?
    const t = p.tasks.find(tk => tk.id === g.id);
    const s = t && t.session;
    return !!s && !t.done && s.phase === 'waiting' && s.members.length === 1 && s.coming.includes(p.id);
  }
  return false;
}

// 🤝 A crewmate is calling and nobody has answered: say "On my way!" (after a moment) and head there.
function answerCalls(room, p, b, lv, now) {
  if (!room.teamMode() || (b.goal && b.goal.kind === 'coop')) return;
  const t = p.tasks.find(x => x.coop && !x.done && x.session && x.session.phase === 'waiting'
    && x.session.callerId !== p.id && !x.session.coming.length && now >= x.lockedUntil);
  if (!t) { b.callSeen = null; return; }
  if (!b.callSeen || b.callSeen.id !== t.id || b.callSeen.ping !== t.session.ping) b.callSeen = { id: t.id, ping: t.session.ping, at: now };
  if (now - b.callSeen.at < lv.coopAnswer) return;
  if (room.coopReply(p.id, t.id, 'coming') !== null) return;
  const spot = coop.helpSpot(t);
  b.goal = { kind: 'coop', id: t.id, x: spot.x, y: spot.y };
  b.path = null;
  b.restUntil = 0;
}

// 🤝 Inside a co-op task: wait for help (or give up), then hold / pump / turn like a person would.
function playCoop(room, p, b, lv, now) {
  const t = p.tasks.find(x => x.id === p.activeTask.taskId);
  const s = t && t.session;
  if (!s) return;
  const me = s.members.find(m => m.id === p.id);
  if (s.phase === 'waiting') {
    b.coopActiveAt = 0;
    if (s.coming.length) { b.coopWaitUntil = now + COOP_WAIT_MS; return; }
    if (!b.coopWaitUntil) b.coopWaitUntil = now + COOP_WAIT_MS;
    if (now >= b.coopWaitUntil) {
      // Nobody came: do something else for a while.
      room.cancelTask(p.id);
      b.coopWaitUntil = 0;
      b.coopSkipUntil = now + COOP_SKIP_MS;
      b.goal = null;
    }
    return;
  }
  b.coopWaitUntil = 0;
  if (!b.coopActiveAt) { b.coopActiveAt = now; b.actAt = 0; }
  const react = () => now + rand(...lv.coopAct);
  if (t.type === 'sail') {
    if (!s.hold[p.id]) {
      if (!b.actAt) b.actAt = react();
      if (now >= b.actAt) { room.coopInput(p.id, { action: 'hold', on: true }); b.actAt = 0; }
    }
  } else if (t.type === 'pump') {
    if ((s.solo || s.turn === p.id) && now >= s.jamUntil) {
      if (!b.actAt) b.actAt = react();
      if (now >= b.actAt) { room.coopInput(p.id, { action: 'pump' }); b.actAt = 0; }
    } else {
      b.actAt = 0;
    }
  } else if (t.type === 'vault' && me) {
    const mine = t.turned[me.lock], theirs = t.turned[1 - me.lock];
    if (mine) return;
    // Turn right after the crewmate does, or go first after a short look around.
    const due = theirs ? (b.actAt || (b.actAt = react())) : b.coopActiveAt + 1500 + (p.id.length % 5) * 300;
    if (now >= due) { room.coopInput(p.id, { action: 'turn' }); b.actAt = 0; }
  }
}

// Throw an item, usually at whoever is ahead.
function useItem(room, p, now) {
  const it = itemById.get(p.pickup);
  if (!it || it.target === 'passive') return true;
  if (it.target !== 'player') return room.usePickup(p.id) === null;
  const targets = [...room.players.values()]
    .filter(q => q !== p && !room.sameTeam(p, q) && !room.targetError(q, it.id, now))
    .sort((a, b) => room.doneCount(b) - room.doneCount(a));
  if (!targets.length) return false;
  const pick = Math.random() < levelOf(room).leaderChance ? targets[0] : targets[Math.floor(Math.random() * targets.length)];
  return room.usePickup(p.id, pick.id) === null;
}

// One server tick for one bot.
function update(room, p, dt, now) {
  const b = brain(p);
  const lv = levelOf(room);
  if (p.inHatch) return;

  // Items: hang on for a moment, then use them.
  if (p.pickup && p.pickup !== 'key') {
    if (!b.itemAt) b.itemAt = now + rand(...lv.itemDelay);
    if (now >= b.itemAt) b.itemAt = useItem(room, p, now) ? 0 : now + 2000;
  }

  if (now < p.netUntil) return; // 🥅 stuck

  // Busy with a task: "play" it for a while, then finish.
  if (p.activeTask) {
    if (p.activeTask.coop) return playCoop(room, p, b, lv, now);
    if (now >= b.taskUntil) {
      room.completeTask(p.id, p.activeTask.taskId);
      b.goal = null;
      b.restUntil = now + rand(...lv.pause);
    }
    return;
  }
  answerCalls(room, p, b, lv, now);
  if (now < b.restUntil) return; // Easy bots stop to think between tasks

  if (!b.goal || !goalStillValid(room, p, b.goal, now)) {
    b.goal = chooseGoal(room, p, now);
    b.path = null;
  }
  const g = b.goal;

  // Arrived?
  const reach = g.kind === 'task' || g.kind === 'coop' ? tasksDef.USE_DIST - 25 : g.kind === 'barrel' ? pickupsDef.GRAB_DIST - 15 : 30;
  if (dist(p, g) <= reach) {
    if (g.kind === 'coop' || (g.kind === 'task' && g.coop)) {
      // 🤝 Join the crewmate who called, or start calling.
      const res = room.startTask(p.id, g.id);
      if (res.error) {
        b.goal = null;
        if (g.kind === 'task') b.coopSkipUntil = now + 3000;
      } else {
        b.coopWaitUntil = 0;
        b.coopActiveAt = 0;
        b.goal = null; // pick afresh once this co-op task is over
      }
    } else if (g.kind === 'task') {
      const res = room.startTask(p.id, g.id);
      if (!res.error) {
        // Bots take a believable amount of time; scrambled tasks take longer.
        const base = typeById.get(g.type).minMs;
        b.taskUntil = now + base + rand(...lv.taskExtra) + (res.scramble ? 2500 : 0);
      } else {
        b.goal = null;
      }
    } else if (g.kind === 'barrel') {
      room.grabBarrel(p.id, g.id);
      b.goal = null;
    } else {
      b.goal = null;
    }
    return;
  }

  // Walk along the route.
  if (!b.path || !b.path.length) b.path = findPath(p, g, room.blockers) || [{ x: g.x, y: g.y }];
  let wp = b.path[0];
  while (wp && dist(p, wp) < 10 && b.path.length > 1) { b.path.shift(); wp = b.path[0]; }

  const mul = pickupsDef.speedMul(now < p.slowUntil, now < p.boostUntil) * lv.walk;
  let ang = Math.atan2(wp.y - p.y, wp.x - p.x);
  if (now < p.rumUntil) ang += Math.sin(now / 300 + b.wobble) * 1.3; // 🍺 staggering
  let vx = Math.cos(ang) * mul, vy = Math.sin(ang) * mul;
  if (now < p.stormUntil) {
    const a = (now / 1000) * 0.9 + b.wobble;
    vx += Math.cos(a) * pickupsDef.STORM_DRIFT;
    vy += Math.sin(a) * pickupsDef.STORM_DRIFT;
  }
  const wave = room.waveDir();
  if (wave) {
    vx += wave.x * eventsDef.WAVE_PUSH;
    vy += wave.y * eventsDef.WAVE_PUSH;
  }
  const res = physics.move(p.x, p.y, vx, vy, dt, 1, room.blockers);
  p.x = res.x;
  p.y = res.y;

  // Stuck against something? Re-plan (and wiggle) once a second.
  if (now >= b.checkAt) {
    if (b.checkAt && Math.hypot(p.x - b.checkX, p.y - b.checkY) < 15) {
      b.path = null;
      const n = physics.sweep(p.x, p.y, p.x + rand(-30, 30), p.y + rand(-30, 30), room.blockers);
      p.x = n.x;
      p.y = n.y;
    }
    b.checkAt = now + 1000;
    b.checkX = p.x;
    b.checkY = p.y;
  }
}

module.exports = { NAMES, LEVEL_IDS, update, wanderLobby, resetBrain, resetPath, findPath, walkableCount: () => walkable.reduce((a, v) => a + v, 0) };
