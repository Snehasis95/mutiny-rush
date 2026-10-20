// Cosmetics: hats, faces, and the winner's parrot.
const test = require('node:test');
const assert = require('node:assert');
const { makeRoom, fakeClock, token } = require('./helpers');
const looks = require('../shared/looks');
const tasksDef = require('../shared/tasks');

test('new players get the default look unless they bring their own', () => {
  const { room } = makeRoom(['A']);
  assert.equal(room.players.get('A').hat, 'tricorn');
  assert.equal(room.players.get('A').eyes, 'patch');
  room.addPlayer('B', 'B', token('B'), 'B', false, { hat: 'straw', eyes: 'monocle' });
  assert.equal(room.players.get('B').hat, 'straw');
  assert.equal(room.players.get('B').eyes, 'monocle');
  room.stopTimers();
});

test('looks can be changed in the lobby, only to real options', () => {
  const { room, io } = makeRoom(['A']);
  room.setLook('A', { hat: 'captain', eyes: 'both' });
  const A = room.players.get('A');
  assert.equal(A.hat, 'captain');
  assert.equal(A.eyes, 'both');
  room.setLook('A', { hat: 'crown-of-cheating', eyes: 'lasers' });
  assert.equal(A.hat, 'tricorn', 'unknown hat accepted');
  assert.equal(A.eyes, 'patch', 'unknown eyes accepted');
  const msg = io.last('TEST', 'room').data.players[0];
  assert.equal(msg.hat, 'tricorn');
  assert.ok('parrot' in msg);
  room.stopTimers();
});

test('looks are locked once the race starts', () => {
  const { room } = makeRoom(['A'], { playing: true });
  room.setLook('A', { hat: 'beanie', eyes: 'both' });
  assert.equal(room.players.get('A').hat, 'tricorn');
  room.stopTimers();
});

test('bots get random looks', () => {
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const { room } = makeRoom(['H'], { options: { botCount: 5 } });
    for (const p of room.players.values()) if (p.isBot) seen.add(p.hat);
    room.stopTimers();
  }
  assert.ok(seen.size >= 4, `bots only wore ${[...seen].join(', ')}`);
  for (const h of seen) assert.ok(looks.hats.some(x => x.id === h));
});

test('the winner gets the parrot, and it moves to the next winner', () => {
  const clock = fakeClock();
  try {
    const { room, p } = makeRoom(['A', 'B'], { playing: true });
    const winAs = id => {
      const pl = p(id);
      for (const t of pl.tasks) {
        pl.x = t.x; pl.y = t.y;
        room.startTask(id, t.type);
        clock.advance(tasksDef.types.find(x => x.id === t.type).minMs + 10);
        room.completeTask(id, t.type);
      }
    };
    winAs('A');
    assert.equal(p('A').parrot, true);
    assert.equal(p('B').parrot, false);
    room.backToLobby('A');
    assert.equal(p('A').parrot, true, 'parrot lost on the way back to the lobby');
    room.start('A');
    clearTimeout(room.countdownTimer);
    room.state = 'playing';
    room.nextEventAt = Infinity;
    winAs('B');
    assert.equal(p('A').parrot, false);
    assert.equal(p('B').parrot, true);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});
