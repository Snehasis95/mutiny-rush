// Computer-controlled pirates. They live on the server and play by the same rules as people:
// they walk (around walls) to their tasks, take a realistic time to do them, grab barrels
// near their route and throw items at whoever is winning.
const map = require('../shared/map');
const physics = require('../shared/physics');
const tasksDef = require('../shared/tasks');
const pickupsDef = require('../shared/pickups');

const NAMES = ['Blackbeard', 'Anne Bonny', 'Calico Jack', 'Long John', 'Barbossa', 'Mad Morgan', 'Flint', 'Davy Jones', 'Mary Read', 'Red Rackham'];

const rand = (a, b) => a + Math.random() * (b - a);
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
function clearLine(a, b) {
  const steps = Math.ceil(dist(a, b) / 8);
  for (let i = 1; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps, y = a.y + ((b.y - a.y) * i) / steps;
    const c = cellOf(x, y);
    if (!isWalk(c.c, c.r)) return false;
  }
  return true;
}

// A* over the grid (8 directions), then the path is straightened where there's a clear line.
function findPath(from, to) {
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
        if (!isWalk(nc, nr)) continue;
        if (dr && dc && (!isWalk(cur.c + dc, cur.r) || !isWalk(cur.c, cur.r + dr))) continue; // no corner cutting
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
    while (j > i && !clearLine(here, cells[j])) j--;
    out.push(cells[j]);
    here = cells[j];
    i = j + 1;
  }
  return out;
}

// ---------------- the bot's brain ----------------
function brain(p) {
  if (!p.brain) p.brain = { goal: null, path: null, taskUntil: 0, itemAt: 0, checkAt: 0, checkX: 0, checkY: 0, wobble: rand(0, 6) };
  return p.brain;
}

function resetBrain(p) {
  p.brain = null;
}

// Where should this bot go next? The nearest open task, or a barrel that's close by.
function chooseGoal(room, p, now) {
  const tasks = p.tasks.filter(t => !t.done && now >= t.lockedUntil);
  const nearestTask = tasks.sort((a, b) => dist(p, a) - dist(p, b))[0];
  if (!p.pickup) {
    const barrel = room.barrels
      .filter(b => b.kind === 'barrel')
      .sort((a, b) => dist(p, a) - dist(p, b))[0];
    const taskD = nearestTask ? dist(p, nearestTask) : Infinity;
    if (barrel && dist(p, barrel) < 380 && dist(p, barrel) < taskD * 0.9) {
      return { kind: 'barrel', id: barrel.id, x: barrel.x, y: barrel.y };
    }
  }
  if (nearestTask) return { kind: 'task', type: nearestTask.type, x: nearestTask.x, y: nearestTask.y };
  // Every task is anchored: drift towards the middle and wait.
  return { kind: 'wait', x: map.spawn.x + rand(-150, 150), y: map.spawn.y + rand(-80, 80) };
}

function goalStillValid(room, p, g, now) {
  if (g.kind === 'barrel') return !p.pickup && room.barrels.some(b => b.id === g.id);
  if (g.kind === 'task') {
    const t = p.tasks.find(tk => tk.type === g.type);
    return t && !t.done && now >= t.lockedUntil;
  }
  return false;
}

// Throw an item, usually at whoever is ahead.
function useItem(room, p, now) {
  const it = itemById.get(p.pickup);
  if (!it || it.target === 'passive') return true;
  if (it.target !== 'player') return room.usePickup(p.id) === null;
  const targets = [...room.players.values()]
    .filter(q => q !== p && !room.targetError(q, it.id, now))
    .sort((a, b) => room.doneCount(b) - room.doneCount(a));
  if (!targets.length) return false;
  const pick = Math.random() < 0.7 ? targets[0] : targets[Math.floor(Math.random() * targets.length)];
  return room.usePickup(p.id, pick.id) === null;
}

// One server tick for one bot.
function update(room, p, dt, now) {
  const b = brain(p);
  if (p.inHatch) return;

  // Items: hang on for a moment, then use them.
  if (p.pickup && p.pickup !== 'key') {
    if (!b.itemAt) b.itemAt = now + rand(1500, 5000);
    if (now >= b.itemAt) b.itemAt = useItem(room, p, now) ? 0 : now + 2000;
  }

  if (now < p.netUntil) return; // 🥅 stuck

  // Busy with a task: "play" it for a while, then finish.
  if (p.activeTask) {
    if (now >= b.taskUntil) {
      room.completeTask(p.id, p.activeTask.type);
      b.goal = null;
    }
    return;
  }

  if (!b.goal || !goalStillValid(room, p, b.goal, now)) {
    b.goal = chooseGoal(room, p, now);
    b.path = null;
  }
  const g = b.goal;

  // Arrived?
  const reach = g.kind === 'task' ? tasksDef.USE_DIST - 25 : g.kind === 'barrel' ? pickupsDef.GRAB_DIST - 15 : 30;
  if (dist(p, g) <= reach) {
    if (g.kind === 'task') {
      const res = room.startTask(p.id, g.type);
      if (!res.error) {
        // Bots take a believable amount of time; scrambled tasks take longer.
        const base = typeById.get(g.type).minMs;
        b.taskUntil = now + base + rand(2500, 6000) + (res.scramble ? 2500 : 0);
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
  if (!b.path || !b.path.length) b.path = findPath(p, g) || [{ x: g.x, y: g.y }];
  let wp = b.path[0];
  while (wp && dist(p, wp) < 10 && b.path.length > 1) { b.path.shift(); wp = b.path[0]; }

  const mul = pickupsDef.speedMul(now < p.slowUntil, now < p.boostUntil);
  let ang = Math.atan2(wp.y - p.y, wp.x - p.x);
  if (now < p.rumUntil) ang += Math.sin(now / 300 + b.wobble) * 1.3; // 🍺 staggering
  let vx = Math.cos(ang) * mul, vy = Math.sin(ang) * mul;
  if (now < p.stormUntil) {
    const a = (now / 1000) * 0.9 + b.wobble;
    vx += Math.cos(a) * pickupsDef.STORM_DRIFT;
    vy += Math.sin(a) * pickupsDef.STORM_DRIFT;
  }
  const res = physics.move(p.x, p.y, vx, vy, dt);
  p.x = res.x;
  p.y = res.y;

  // Stuck against something? Re-plan (and wiggle) once a second.
  if (now >= b.checkAt) {
    if (b.checkAt && Math.hypot(p.x - b.checkX, p.y - b.checkY) < 15) {
      b.path = null;
      const n = physics.sweep(p.x, p.y, p.x + rand(-30, 30), p.y + rand(-30, 30));
      p.x = n.x;
      p.y = n.y;
    }
    b.checkAt = now + 1000;
    b.checkX = p.x;
    b.checkY = p.y;
  }
}

module.exports = { NAMES, update, resetBrain, findPath, walkableCount: () => walkable.reduce((a, v) => a + v, 0) };
