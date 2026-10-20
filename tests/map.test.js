// The ship layout: every room reachable, every spot on open floor.
const test = require('node:test');
const assert = require('node:assert');
const map = require('../shared/map');
const physics = require('../shared/physics');
const { stations } = require('../shared/tasks');

const R = physics.PLAYER_R;
const isFree = (x, y) => {
  const r = physics.resolve(x, y);
  return Math.hypot(r.x - x, r.y - y) < 0.5;
};
const areaOf = (x, y) => map.areas.find(a => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h);

// Flood-fill the walkable floor from the spawn point (10-unit grid).
function reachable() {
  const G = 10, seen = new Set(), start = [1200, 620], q = [start];
  seen.add(start.join());
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[G, 0], [-G, 0], [0, G], [0, -G]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (seen.has(k) || nx < R || ny < R || nx > map.W - R || ny > map.H - R || !isFree(nx, ny)) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return seen;
}
const floor = reachable();
const canReach = (x, y) => [...floor].some(k => {
  const [fx, fy] = k.split(',').map(Number);
  return Math.hypot(fx - x, fy - y) < 15;
});

test('every area of the ship can be walked to from the spawn', () => {
  for (const a of map.areas) {
    const inside = [...floor].some(k => {
      const [x, y] = k.split(',').map(Number);
      return x > a.x && x < a.x + a.w && y > a.y && y < a.y + a.h;
    });
    assert.ok(inside, `${a.name} is unreachable`);
  }
});

test('all spawn points are clear', () => {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    assert.ok(isFree(map.spawn.x + Math.cos(a) * map.spawn.r, map.spawn.y + Math.sin(a) * map.spawn.r), `spawn ${i}`);
  }
});

test('walls stop you and doorways let you through', () => {
  const through = physics.sweep(500, 175, 700, 175); // cabin door
  assert.equal(Math.round(through.x), 700);
  const blocked = physics.sweep(300, 600, 300, 900); // map table in the way... then wall at y=700 except door
  assert.ok(blocked.y <= 900);
  const wall = physics.sweep(1000, 300, 1000, -100); // top hull
  assert.ok(wall.y >= R, 'walked through the hull');
});

test('every task station is on reachable open floor, inside an area', () => {
  for (const s of stations) {
    assert.ok(isFree(s.x, s.y), `${s.id} is inside furniture`);
    assert.ok(areaOf(s.x, s.y), `${s.id} is outside the ship`);
    assert.ok(canReach(s.x, s.y), `${s.id} can't be reached`);
  }
});

test('hatches and barrel spots are on open floor and away from task stations', () => {
  for (const s of [...map.hatches, ...map.barrelSpots]) {
    assert.ok(isFree(s.x, s.y), `blocked spot at ${s.x},${s.y}`);
    assert.ok(canReach(s.x, s.y), `unreachable spot at ${s.x},${s.y}`);
    const near = stations.find(st => Math.hypot(st.x - s.x, st.y - s.y) < 100);
    assert.ok(!near, `spot ${s.x},${s.y} sits on station ${near && near.id}`);
  }
});

test('every listed doorway is a real gap in the walls', () => {
  for (const d of map.doors) assert.ok(isFree(d.x, d.y), `door at ${d.x},${d.y} is a wall`);
});

test('temporary blockers (octopuses) stop movement', () => {
  const block = [{ x: 572, y: 95, w: 56, h: 160 }]; // cabin doorway
  const r = physics.sweep(700, 175, 450, 175, block);
  assert.ok(r.x > 600, 'walked through the blocker');
});
