// Barrels, every item, immunity, Lucky Coin, keys and hatches.
const test = require('node:test');
const assert = require('node:assert');
const { makeRoom } = require('./helpers');
const map = require('../shared/map');

const now = () => Date.now();
const give = (p, item) => {
  p.pickup = item;
  if (item === 'key') { p.keyUntil = now() + 30000; p.keyTrips = 3; }
};
const clean = (...ps) => ps.forEach(p => { p.immuneUntil = 0; p.shield = false; p.activeTask = null; });

test('barrels: grab when close, one item at a time, max 6 on deck, never a key inside', () => {
  const { room, p } = makeRoom(['A', 'B'], { playing: true });
  const A = p('A');
  room.spawnBarrel();
  const b = room.barrels[0];
  assert.ok(room.grabBarrel('A', b.id).error, 'grabbed from far away');
  A.x = b.x; A.y = b.y;
  const r = room.grabBarrel('A', b.id);
  assert.equal(r.error, null);
  assert.ok(A.pickup);
  assert.ok(!room.barrels.some(x => x.id === b.id));
  room.spawnBarrel();
  const b2 = room.barrels[0];
  A.x = b2.x; A.y = b2.y;
  assert.match(room.grabBarrel('A', b2.id).error, /hands are full/);
  for (let i = 0; i < 20; i++) room.spawnBarrel();
  assert.equal(room.barrels.filter(x => x.kind === 'barrel').length, 6);
  for (let i = 0; i < 5000; i++) assert.notEqual(room.rollItem(A), 'key');
  room.stopTimers();
});

test('players who are behind get the strong items more often', () => {
  const { room, p } = makeRoom(['A', 'B'], { playing: true });
  p('A').tasks.slice(0, 5).forEach(t => (t.done = true));
  const count = (pl, item) => { let n = 0; for (let i = 0; i < 20000; i++) if (room.rollItem(pl) === item) n++; return n; };
  assert.ok(count(p('B'), 'wave') > count(p('A'), 'wave') * 2);
  room.stopTimers();
});

test('anchor locks a task; target becomes immune; refused items are kept', () => {
  const { room, p } = makeRoom(['A', 'B', 'C'], { playing: true });
  const [A, B, C] = ['A', 'B', 'C'].map(p);
  give(A, 'anchor');
  assert.equal(room.usePickup('A', 'B'), null);
  const locked = B.tasks.find(t => t.lockedUntil > now());
  assert.ok(locked);
  B.x = locked.x; B.y = locked.y;
  assert.match(room.startTask('B', locked.type).error, /anchored/);
  assert.ok(B.immuneUntil > now());
  give(C, 'slime');
  assert.equal(room.usePickup('C', 'B'), 'Immune right now');
  assert.equal(C.pickup, 'slime');
  room.stopTimers();
});

test('slime slows and knocks you out of your mini-game', () => {
  const { room, io, p } = makeRoom(['A', 'C'], { playing: true });
  const C = p('C');
  const t = C.tasks[0];
  C.x = t.x; C.y = t.y;
  room.startTask('C', t.type);
  give(p('A'), 'slime');
  room.usePickup('A', 'C');
  assert.ok(C.slowUntil > now());
  assert.equal(C.activeTask, null);
  assert.ok(io.last('C', 'interrupt'));
  room.stopTimers();
});

test('Lucky Coin blocks the next sabotage and is used up', () => {
  const { room, io, p } = makeRoom(['A', 'C'], { playing: true });
  const C = p('C');
  give(C, 'coin');
  room.usePickup('C');
  assert.equal(C.shield, true);
  give(p('A'), 'parrot');
  room.usePickup('A', 'C');
  assert.equal(C.shield, false);
  assert.equal(C.scramble, false);
  assert.equal(io.last('TEST', 'fx').data.blocked, true);
  room.stopTimers();
});

test('parrot scrambles exactly the next task', () => {
  const { room, p } = makeRoom(['A', 'C'], { playing: true });
  const C = p('C');
  give(p('A'), 'parrot');
  room.usePickup('A', 'C');
  const t = C.tasks[0];
  C.x = t.x; C.y = t.y;
  assert.equal(room.startTask('C', t.type).scramble, true);
  assert.equal(C.scramble, false);
  room.stopTimers();
});

test('Big Wave only works on a rival with finished tasks who is not about to win', () => {
  const { room, p } = makeRoom(['A', 'B'], { playing: true });
  const B = p('B');
  give(p('A'), 'wave');
  assert.equal(room.usePickup('A', 'B'), 'No finished tasks');
  B.tasks.slice(0, 5).forEach(t => (t.done = true));
  assert.equal(room.usePickup('A', 'B'), 'Too close to winning');
  B.tasks[4].done = false;
  assert.equal(room.usePickup('A', 'B'), null);
  assert.equal(room.doneCount(B), 3);
  room.stopTimers();
});

test('fog, storm and rum hit every rival but not the user', () => {
  for (const [item, field] of [['fog', 'fogUntil'], ['storm', 'stormUntil'], ['rum', 'rumUntil']]) {
    const { room, p } = makeRoom(['A', 'B', 'C'], { playing: true });
    give(p('A'), item);
    assert.equal(room.usePickup('A'), null, item);
    assert.ok(p('B')[field] > now() && p('C')[field] > now(), `${item} missed a rival`);
    assert.equal(p('A')[field], 0, `${item} hit the user`);
    room.stopTimers();
  }
});

test('hit-everyone items skip immune rivals; the coin blocks them with a notice', () => {
  const { room, io, p } = makeRoom(['A', 'B', 'C'], { playing: true });
  p('B').immuneUntil = now() + 5000;
  p('C').shield = true;
  give(p('A'), 'storm');
  room.usePickup('A');
  assert.equal(p('B').stormUntil, 0);
  assert.equal(p('C').stormUntil, 0);
  assert.match(io.last('C', 'notice').data.text, /Storm/);
  room.stopTimers();
});

test('alarm only bothers rivals who are doing a task', () => {
  const { room, p } = makeRoom(['A', 'B', 'C'], { playing: true });
  const B = p('B');
  const t = B.tasks[0];
  B.x = t.x; B.y = t.y;
  room.startTask('B', t.type);
  p('C').shield = true;
  give(p('A'), 'alarm');
  room.usePickup('A');
  assert.equal(B.activeTask, null);
  assert.ok(B.immuneUntil > now());
  assert.equal(p('C').immuneUntil, 0);
  assert.equal(p('C').shield, true, 'idle rival lost their coin');
  room.stopTimers();
});

test('wind doubles your speed (and the server allows it)', () => {
  const { room, p } = makeRoom(['A', 'B'], { playing: true });
  const [A, B] = [p('A'), p('B')];
  give(A, 'wind');
  room.usePickup('A');
  assert.ok(A.boostUntil > now());
  for (const pl of [A, B]) { pl.x = 1200; pl.y = 700; pl.budget = 0; pl.lastMoveAt = now() - 500; }
  room.handleMove('A', 1500, 700);
  room.handleMove('B', 1500, 700);
  assert.ok(A.x - 1200 > 250, `boosted moved ${A.x - 1200}`);
  assert.ok(B.x - 1200 < 230, `normal moved ${B.x - 1200}`);
  room.stopTimers();
});

test('fishing net: needs a target, freezes them, blocks USE but not items', () => {
  const { room, p } = makeRoom(['A', 'B', 'C'], { playing: true });
  const B = p('B');
  give(p('A'), 'net');
  assert.equal(room.usePickup('A'), 'Pick a rival.');
  assert.equal(room.usePickup('A', 'B'), null);
  assert.ok(B.netUntil > now());
  const x0 = B.x;
  B.budget = 500;
  room.handleMove('B', B.x + 100, B.y);
  assert.equal(B.x, x0);
  const t = B.tasks[0];
  B.x = t.x; B.y = t.y;
  assert.match(room.startTask('B', t.type).error, /net/);
  give(B, 'slime');
  assert.equal(room.usePickup('B', 'C'), null);
  room.stopTimers();
});

test('keys lie on the deck, at most 2, and grabbing one gives 3 hatch trips', () => {
  const { room, p } = makeRoom(['A'], { playing: true });
  const A = p('A');
  for (let i = 0; i < 5; i++) room.spawnBarrel('key');
  const keys = room.barrels.filter(b => b.kind === 'key');
  assert.equal(keys.length, 2);
  A.x = keys[0].x; A.y = keys[0].y;
  assert.equal(room.grabBarrel('A', keys[0].id).item, 'key');
  assert.equal(A.keyTrips, 3);
  room.stopTimers();
});

test('hatches: key needed, hidden inside, travel within a network, auto-eject, key wears out', () => {
  const { room, io, p } = makeRoom(['A', 'B'], { playing: true });
  const A = p('A');
  const cabin = map.hatches.find(h => h.id === 'h-cabin');
  const nest = map.hatches.find(h => h.id === 'h-nest');
  A.x = cabin.x; A.y = cabin.y;
  assert.ok(room.enterHatch('A', 'h-cabin'), 'entered without a key');
  give(A, 'key');
  assert.equal(room.enterHatch('A', 'h-cabin'), null);
  assert.equal(room.targetError(A, 'slime', now()), 'Hidden in a hatch');
  room.handleMove('A', A.x + 100, A.y);
  assert.equal(A.x, cabin.x, 'walked while inside');
  assert.ok(room.travelHatch('A', 'h-galley'), 'travelled to another network');
  assert.equal(room.travelHatch('A', 'h-nest'), null);
  assert.equal(A.x, nest.x);
  assert.equal(A.keyTrips, 2);
  room.tick();
  assert.equal(io.last('TEST', 'state').data.p.find(x => x[0] === 'A')[3], 1, 'not hidden from others');
  assert.equal(room.exitHatch('A'), null);
  assert.equal(io.last('TEST', 'fx').data.kind, 'puff');
  room.enterHatch('A', 'h-nest');
  A.hatchAt = now() - 6000;
  room.tick();
  assert.equal(A.inHatch, null, 'not pushed out after 5s');
  room.enterHatch('A', 'h-nest');
  room.travelHatch('A', 'h-cabin');
  room.travelHatch('A', 'h-nest');
  assert.equal(A.keyTrips, 0);
  room.exitHatch('A');
  assert.equal(A.pickup, null, 'worn-out key kept');
  room.stopTimers();
});
