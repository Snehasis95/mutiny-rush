// Tasks: fair assignment, task-count option, finishing tasks, winning, rematch.
const test = require('node:test');
const assert = require('node:assert');
const { makeRoom, fakeClock } = require('./helpers');
const { tourLength } = require('../server/taskAssign');
const tasksDef = require('../shared/tasks');

const typeOf = id => tasksDef.types.find(t => t.id === id);

test('default game gives everyone 6 tasks', () => {
  const { room } = makeRoom(['A', 'B', 'C'], { playing: true });
  for (const p of room.players.values()) assert.equal(p.tasks.length, 6);
  room.stopTimers();
});

for (const n of [3, 6, 10]) {
  test(`${n} tasks: same types for everyone, no repeats, fair walking`, () => {
    for (let rep = 0; rep < 30; rep++) {
      const { room } = makeRoom(['A', 'B', 'C', 'D', 'E', 'F'], { playing: true, options: { taskCount: n } });
      const list = [...room.players.values()];
      const sets = list.map(p => p.tasks.map(t => t.type).sort().join());
      assert.equal(new Set(sets).size, 1, 'players got different task types');
      for (const p of list) {
        assert.equal(p.tasks.length, n);
        assert.equal(new Set(p.tasks.map(t => t.type)).size, n, 'duplicate task type');
      }
      const lens = list.map(p => tourLength(p.tasks));
      const spread = (Math.max(...lens) - Math.min(...lens)) / Math.min(...lens);
      assert.ok(spread < 0.25, `walking distances too different: ${(spread * 100).toFixed(1)}%`);
      room.stopTimers();
    }
  });
}

test('all 10 task types show up across games', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const { room } = makeRoom(['A'], { playing: true, options: { taskCount: 4 } });
    room.players.get('A').tasks.forEach(t => seen.add(t.type));
    room.stopTimers();
  }
  assert.equal(seen.size, tasksDef.types.length);
});

test('only the Captain can change options, and only to sensible values', () => {
  const { room } = makeRoom(['A', 'B']);
  room.setOption('B', 'taskCount', 4);
  assert.equal(room.options.taskCount, 6, 'guest changed it');
  for (const bad of [2, 11, 5.5, '7', null]) room.setOption('A', 'taskCount', bad);
  assert.equal(room.options.taskCount, 6, 'accepted a bad value');
  room.setOption('A', 'taskCount', 10);
  assert.equal(room.options.taskCount, 10);
  room.setOption('A', 'taskArrows', false);
  assert.equal(room.options.taskArrows, false);
  room.stopTimers();
});

test('players only learn where their own tasks are', () => {
  const { room, io } = makeRoom(['A', 'B'], { playing: true });
  const roomMsg = io.last('TEST', 'room').data;
  assert.ok(!JSON.stringify(roomMsg).includes('stationId'));
  const bTasks = io.last('B', 'tasks').data;
  assert.deepEqual(bTasks.map(t => t.stationId), room.players.get('B').tasks.map(t => t.stationId));
  room.stopTimers();
});

test('task rules: must be close, cannot finish too fast, must have started it', () => {
  const { room, p } = makeRoom(['A', 'B'], { playing: true });
  const A = p('A');
  const t = A.tasks[0];
  assert.match(room.startTask('A', t.type).error, /closer/);
  A.x = t.x; A.y = t.y;
  assert.equal(room.startTask('A', t.type).error, null);
  assert.equal(room.completeTask('A', t.type), 'Too fast!');
  assert.match(room.completeTask('A', A.tasks[1].type), /interrupted/);
  room.stopTimers();
});

test('walking away cancels a task in progress', () => {
  const { room, p } = makeRoom(['A'], { playing: true });
  const A = p('A');
  const t = A.tasks[0];
  A.x = t.x; A.y = t.y;
  room.startTask('A', t.type);
  // Teleport straight away from the station (the server just checks where you end up).
  A.x = t.x + (t.x < 1200 ? 300 : -300);
  room.handleMove('A', A.x, A.y);
  assert.equal(A.activeTask, null);
  room.stopTimers();
});

test('finishing every task wins; Captain can start a rematch with new tasks', () => {
  const clock = fakeClock();
  try {
    const { room, io, p } = makeRoom(['A', 'B'], { playing: true });
    const A = p('A');
    for (const t of A.tasks) {
      A.x = t.x; A.y = t.y;
      assert.equal(room.startTask('A', t.type).error, null);
      clock.advance(typeOf(t.type).minMs + 10);
      assert.equal(room.completeTask('A', t.type), null);
    }
    const msg = io.last('TEST', 'room').data;
    assert.equal(msg.state, 'ended');
    assert.equal(msg.winnerId, 'A');
    assert.match(room.startTask('B', p('B').tasks[0].type).error, /not running/);
    room.backToLobby('B');
    assert.equal(room.state, 'ended', 'guest sent everyone to the lobby');
    room.backToLobby('A');
    assert.equal(room.state, 'lobby');
    room.start('A');
    clearTimeout(room.countdownTimer);
    assert.equal(A.tasks.length, 6);
    assert.ok(A.tasks.every(t => !t.done));
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('the server limits how fast you can move', () => {
  const { room, p } = makeRoom(['A'], { playing: true });
  const A = p('A');
  const x0 = A.x;
  room.handleMove('A', x0 + 2000, A.y); // teleport attempt
  assert.ok(A.x - x0 < 400, `moved ${A.x - x0}`);
  room.stopTimers();
});
