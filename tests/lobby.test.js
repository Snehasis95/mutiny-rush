// The walkable lobby room (Captain's Quarters).
const test = require('node:test');
const assert = require('node:assert');
const { makeRoom, fakeClock, token } = require('./helpers');
const lobbyMap = require('../shared/lobbyMap');
const physics = require('../shared/physics');
const map = require('../shared/map');

const lobbyPhysics = physics.create(lobbyMap);
const inRoom = p => p.x > 0 && p.y > 0 && p.x < lobbyMap.W && p.y < lobbyMap.H;
const isFree = (ph, x, y) => { const r = ph.resolve(x, y); return Math.hypot(r.x - x, r.y - y) < 0.5; };

test('the lobby room: free spots around the wheel, wheel and walls are solid', () => {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    assert.ok(isFree(lobbyPhysics, lobbyMap.spawn.x + Math.cos(a) * lobbyMap.spawn.r, lobbyMap.spawn.y + Math.sin(a) * lobbyMap.spawn.r));
  }
  assert.ok(!isFree(lobbyPhysics, lobbyMap.W / 2, lobbyMap.H / 2), 'you can stand inside the wheel');
  const out = lobbyPhysics.sweep(lobbyMap.W / 2, 150, lobbyMap.W / 2, -300);
  assert.ok(out.y > 26, 'walked out through the wall');
});

test('people arrive in the lobby room, on open floor', () => {
  const { room } = makeRoom(['A', 'B', 'C']);
  for (const p of room.players.values()) {
    assert.ok(inRoom(p), `${p.id} is outside the room`);
    assert.ok(isFree(lobbyPhysics, p.x, p.y), `${p.id} is stuck in furniture`);
  }
  room.stopTimers();
});

test('you can walk around the lobby, but not through the walls or the wheel', () => {
  const { room, p } = makeRoom(['A']);
  const A = p('A');
  A.x = 300; A.y = 300; A.lastMoveAt = Date.now() - 1000;
  room.handleMove('A', 350, 300);
  assert.equal(Math.round(A.x), 350, 'could not walk');
  A.budget = 10000;
  for (let i = 0; i < 20; i++) { A.lastMoveAt = Date.now() - 1000; room.handleMove('A', A.x - 100, A.y); }
  assert.ok(A.x >= 26, 'walked through the wall');
  A.x = lobbyMap.W / 2 - 150; A.y = lobbyMap.H / 2;
  for (let i = 0; i < 10; i++) { A.lastMoveAt = Date.now() - 1000; room.handleMove('A', A.x + 60, A.y); }
  assert.ok(A.x < lobbyMap.W / 2, 'walked through the wheel');
  room.stopTimers();
});

test('the lobby shares everyone\'s position, and bots stroll about inside the room', () => {
  const clock = fakeClock();
  try {
    const { room, io } = makeRoom(['H'], { options: { botCount: 3 } });
    const bots = [...room.players.values()].filter(p => p.isBot);
    const start = bots.map(b => ({ x: b.x, y: b.y }));
    for (let i = 0; i < 200; i++) { clock.advance(50); room.lobbyTick(); }
    assert.ok(io.last('TEST', 'state'), 'no positions sent in the lobby');
    assert.ok(bots.some((b, i) => Math.hypot(b.x - start[i].x, b.y - start[i].y) > 30), 'bots never moved');
    for (const b of bots) assert.ok(inRoom(b) && isFree(lobbyPhysics, b.x, b.y), 'a bot wandered off');
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('Set Sail moves everyone to the ship; Play again brings them back to the room', () => {
  const clock = fakeClock();
  try {
    const { room, io, p } = makeRoom(['A', 'B']);
    room.start('A');
    clearTimeout(room.countdownTimer);
    room.state = 'playing';
    for (const pl of room.players.values()) {
      assert.ok(Math.hypot(pl.x - map.spawn.x, pl.y - map.spawn.y) < map.spawn.r + 5, 'not on the ship spawn');
    }
    room.end('A');
    room.backToLobby('A');
    for (const pl of room.players.values()) {
      assert.ok(inRoom(pl) && isFree(lobbyPhysics, pl.x, pl.y), 'not back in the lobby room');
    }
    assert.ok(io.last('B', 'correct'), 'player was not moved back');
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('joining mid-lobby still works with reconnect tokens', () => {
  const { room } = makeRoom(['A']);
  room.addPlayer('B', 'B', token('B'), 'B');
  assert.ok(inRoom(room.players.get('B')));
  room.stopTimers();
});
