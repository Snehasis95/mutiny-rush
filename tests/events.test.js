// Random ship events: timing, Kraken doorways, Rogue Wave, the on/off option.
const test = require('node:test');
const assert = require('node:assert');
const { makeRoom, fakeClock, runTicks } = require('./helpers');
const ev = require('../shared/events');
const map = require('../shared/map');

function connected(blocked) {
  const open = map.doors.filter(d => !blocked.includes(d));
  const seen = new Set(['deck']);
  const q = ['deck'];
  while (q.length) {
    const a = q.shift();
    for (const d of open) {
      const o = d.a === a ? d.b : d.b === a ? d.a : null;
      if (o && !seen.has(o)) { seen.add(o); q.push(o); }
    }
  }
  return seen.size === map.areas.length;
}

test('Kraken: 3 doorways, never traps a room, spread out and fair', () => {
  const { room } = makeRoom(['A']);
  const counts = new Map(map.doors.map(d => [d, 0]));
  const side = d => (d.x < 900 ? 'L' : d.x > 1500 ? 'R' : 'M');
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const doors = room.pickKrakenDoors();
    assert.equal(doors.length, 3);
    assert.ok(connected(doors), 'a room got cut off');
    assert.ok(new Set(doors.map(side)).size >= 2, 'all doorways on one side');
    for (const d of doors) counts.set(d, counts.get(d) + 1);
  }
  for (const [d, c] of counts) {
    const pct = (c / N) * 100;
    assert.ok(pct > 10 && pct < 28, `doorway ${d.a}-${d.b} picked ${pct.toFixed(1)}%`);
  }
  room.stopTimers();
});

test('event timing: first at 30s, 3s warning, ends, quiet gap, then a different one', () => {
  const clock = fakeClock();
  try {
    const { room } = makeRoom(['A'], { playing: true });
    room.nextEventAt = clock.now + ev.FIRST_MS;
    runTicks(room, clock, ev.FIRST_MS - 100);
    assert.equal(room.event, null, 'started too early');
    runTicks(room, clock, 200);
    assert.equal(room.event.phase, 'warning');
    const first = room.event.id;
    runTicks(room, clock, ev.WARNING_MS);
    assert.equal(room.event.phase, 'active');
    let guard = 0;
    while (room.event && guard++ < 400) runTicks(room, clock, 50);
    assert.equal(room.event, null);
    assert.equal(room.blockers.length, 0);
    const gap = room.nextEventAt - clock.now;
    assert.ok(gap >= 34900 && gap <= 50000, `gap ${gap}ms`);
    guard = 0;
    while (!room.event && guard++ < 2000) runTicks(room, clock, 50);
    assert.notEqual(room.event.id, first, 'same event twice in a row');
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('Kraken blocks the doorway, shoves people out of it, then leaves', () => {
  const clock = fakeClock();
  try {
    const { room, p } = makeRoom(['A'], { playing: true });
    const A = p('A');
    const door = map.doors[0]; // cabin <-> deck at (600, 175)
    room.pickKrakenDoors = () => [door];
    A.x = door.x; A.y = door.y;
    room.nextEventAt = clock.now;
    room.lastEventId = 'eclipse';
    const types = ev.types;
    // Force the Kraken
    const realRandom = Math.random;
    Math.random = () => 0;
    runTicks(room, clock, 50);
    Math.random = realRandom;
    assert.equal(room.event.id, 'kraken');
    runTicks(room, clock, ev.WARNING_MS + 50);
    assert.ok(Math.abs(A.x - door.x) > 50, 'still standing in the blocked doorway');
    const onDeck = A.x > 600;
    A.x = onDeck ? 650 : 550; A.budget = 1000; A.lastMoveAt = clock.now - 1000;
    room.handleMove('A', onDeck ? 450 : 750, 175);
    assert.ok(onDeck ? A.x > 600 : A.x < 600, 'walked through the octopus');
    runTicks(room, clock, types.find(t => t.id === 'kraken').ms + 100);
    A.budget = 1000; A.lastMoveAt = clock.now - 1000;
    room.handleMove('A', onDeck ? 450 : 750, 175);
    assert.ok(onDeck ? A.x < 600 : A.x > 600, 'doorway still blocked after the event');
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('Rogue Wave cancels mini-games and the server allows its push', () => {
  const clock = fakeClock();
  try {
    const { room, io, p } = makeRoom(['A'], { playing: true });
    const A = p('A');
    const t = A.tasks[0];
    A.x = t.x; A.y = t.y;
    room.startTask('A', t.type);
    room.event = { id: 'wave', phase: 'warning', startsAt: clock.now + 10, endsAt: clock.now + 4010, data: { dir: { x: 1, y: 0 } } };
    runTicks(room, clock, 100);
    assert.equal(A.activeTask, null);
    assert.ok(io.last('A', 'interrupt'));
    A.x = 1000; A.y = 600; A.budget = 0; A.lastMoveAt = clock.now - 500;
    room.handleMove('A', 1280, 600);
    assert.ok(A.x - 1000 > 220, `push refused: moved ${A.x - 1000}`);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('events can be switched off by the Captain', () => {
  const clock = fakeClock();
  try {
    const { room, io } = makeRoom(['A', 'B'], { playing: true });
    assert.equal(room.options.events, true);
    room.state = 'lobby';
    room.setOption('B', 'events', false);
    assert.equal(room.options.events, true, 'guest switched events off');
    room.setOption('A', 'events', false);
    room.state = 'playing';
    room.nextEventAt = clock.now;
    runTicks(room, clock, 120000);
    assert.equal(room.event, null);
    assert.ok(!io.sent.some(s => s.ev === 'event'), 'an event was sent');
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('bots still win races through lots of events', () => {
  const clock = fakeClock();
  try {
    const { room } = makeRoom(['H'], { options: { botCount: 2, taskCount: 6 } });
    room.start('H');
    clearTimeout(room.countdownTimer);
    room.state = 'playing';
    room.nextEventAt = clock.now + 2000;
    let ticks = 0;
    while (room.state === 'playing' && ticks < 20 * 300) {
      runTicks(room, clock, 50);
      ticks++;
      if (!room.event && room.nextEventAt - clock.now > 8000) room.nextEventAt = clock.now + 8000;
    }
    assert.equal(room.state, 'ended');
    assert.ok(room.players.get(room.winnerId).isBot);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});
