// 🤝 Co-op tasks in Teams: the help call, joining, the three mini-games, leaving, bots.
const test = require('node:test');
const assert = require('node:assert');
const { makeRoom, fakeClock, runTicks } = require('./helpers');
const tasksDef = require('../shared/tasks');
const bots = require('../server/bots');
const physics = require('../shared/physics');
const map = require('../shared/map');

const { COOP } = tasksDef;
const coopOf = (p, type) => p.tasks.find(t => t.coop && (!type || t.type === type));
const standAt = (p, x, y) => { p.x = x; p.y = y; };

// Red: A, C   Blue: B, D (players join the smaller crew in turn)
function coopGame(ids = ['A', 'B', 'C', 'D'], opts = {}) {
  const r = makeRoom(ids, { options: { mode: 'team', taskCount: 6, ...opts } });
  r.room.start(ids[0]);
  clearTimeout(r.room.countdownTimer);
  r.room.state = 'playing';
  r.room.nextEventAt = Infinity;
  r.room.nextBarrelAt = Infinity;
  r.room.nextKeyAt = Infinity;
  return r;
}

// Make sure the crew has this co-op task (they're picked at random).
function ensure(room, team, type) {
  const list = room.teamTasks[team];
  let t = list.find(x => x.coop && x.type === type);
  if (!t) {
    const other = list.find(x => x.coop);
    const s = tasksDef.coopStations.find(x => x.type === type);
    Object.assign(other, { id: `${team}:coop:${type}`, type, x: s.x, y: s.y, x2: s.x2 == null ? null : s.x2, y2: s.y2 == null ? null : s.y2 });
    t = other;
  }
  return t;
}

test('crews get co-op tasks instead of normal ones; crews of one and solo races get none', () => {
  const r6 = coopGame(['A', 'B', 'C', 'D'], { taskCount: 6 });
  for (const team of ['red', 'blue']) {
    const list = r6.room.teamTasks[team];
    assert.equal(list.length, 12, 'list length changed');
    assert.equal(list.filter(t => t.coop).length, 2);
  }
  // Both crews get the same co-op tasks
  const kinds = team => r6.room.teamTasks[team].filter(t => t.coop).map(t => t.type).sort().join();
  assert.equal(kinds('red'), kinds('blue'));
  r6.room.stopTimers();

  const r4 = coopGame(['A', 'B', 'C', 'D'], { taskCount: 4 });
  assert.equal(r4.room.teamTasks.red.filter(t => t.coop).length, 1);
  r4.room.stopTimers();

  const r3 = coopGame(['A', 'B', 'C']); // blue is just B
  assert.equal(r3.room.teamTasks.blue.filter(t => t.coop).length, 0, 'a crew of one got a co-op task');
  assert.equal(r3.room.teamTasks.red.filter(t => t.coop).length, 2);
  r3.room.stopTimers();

  const solo = makeRoom(['A', 'B'], { playing: true });
  assert.ok(solo.room.players.get('A').tasks.every(t => !t.coop));
  solo.room.stopTimers();
});

test('every co-op spot is on open floor and bots can walk there', () => {
  for (const s of tasksDef.coopStations) {
    for (const spot of s.x2 == null ? [s] : [s, { x: s.x2, y: s.y2 }]) {
      const res = physics.resolve(spot.x, spot.y);
      assert.ok(Math.hypot(res.x - spot.x, res.y - spot.y) < 1, `${s.type} spot is inside something`);
      const path = bots.findPath(map.spawn, spot);
      assert.ok(path, `no route to ${s.type}`);
      let pos = { x: map.spawn.x, y: map.spawn.y };
      for (const wp of path) pos = physics.sweep(pos.x, pos.y, wp.x, wp.y);
      assert.ok(Math.hypot(pos.x - spot.x, pos.y - spot.y) < 40, `route to ${s.type} ends short`);
    }
  }
});

test('the call: only your crew hears it; first "On my way" claims it; "Go anyway"; whoever arrives joins', () => {
  const { room, io, p } = coopGame(['A', 'B', 'C', 'D', 'E', 'F']); // red: A C E  blue: B D F
  const t = ensure(room, 'red', 'sail');
  standAt(p('A'), t.x, t.y);
  assert.deepEqual(room.startTask('A', t.id), { error: null, coop: true });
  assert.equal(t.session.phase, 'waiting');
  const calls = io.last('C', 'coopCalls').data;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].callerId, 'A');
  assert.equal(calls[0].type, 'sail');
  assert.ok(!io.sent.some(s => s.id === 'B' && s.ev === 'coopCalls' && s.data.length), 'the other crew heard the call');
  // Rivals can't answer or join
  assert.ok(room.coopReply('B', t.id, 'coming'));
  standAt(p('B'), t.x, t.y);
  assert.ok(room.startTask('B', t.id).error);

  assert.equal(room.coopReply('C', t.id, 'coming'), null);
  assert.deepEqual(io.last('E', 'coopCalls').data[0].coming, ['C']);
  assert.equal(room.coopReply('E', t.id, 'coming'), null); // "Go anyway"
  assert.deepEqual(t.session.coming, ['C', 'E']);
  // E gets there first and joins; C is told
  standAt(p('E'), t.x + 30, t.y);
  assert.equal(room.startTask('E', t.id).error, null);
  assert.equal(t.session.phase, 'active');
  const end = io.last('C', 'coopEnd').data;
  assert.equal(end.reason, 'joined');
  assert.equal(end.by, 'E');
  assert.equal(end.wasComing, true);
  assert.equal(io.last('C', 'coopCalls').data.length, 0, 'call still open');
  // Full: a third crewmate can't squeeze in
  standAt(p('C'), t.x, t.y);
  assert.match(room.startTask('C', t.id).error, /already on it/);
  room.stopTimers();
});

test('⛵ Mainsail: rises only while both hold, slips back when one lets go', () => {
  const clock = fakeClock();
  try {
    const { room, io, p } = coopGame();
    const t = ensure(room, 'red', 'sail');
    standAt(p('A'), t.x, t.y);
    standAt(p('C'), t.x, t.y);
    room.startTask('A', t.id);
    room.startTask('C', t.id);
    room.coopInput('A', { action: 'hold', on: true });
    runTicks(room, clock, 2000);
    assert.equal(t.session.progress, 0, 'rose with one hand');
    room.coopInput('C', { action: 'hold', on: true });
    runTicks(room, clock, 2000);
    const half = t.session.progress;
    assert.ok(half > 0.4 && half < 0.6, `progress ${half}`);
    room.coopInput('C', { action: 'hold', on: false });
    runTicks(room, clock, 1000);
    assert.ok(t.session.progress < half, 'did not slip');
    assert.equal(io.last('A', 'coop').data.hold.join(), 'A');
    room.coopInput('C', { action: 'hold', on: true });
    runTicks(room, clock, 3000);
    assert.equal(t.done, true);
    assert.equal(t.doneBy, 'A');
    assert.equal(t.doneWith, 'C');
    assert.equal(p('A').activeTask, null);
    assert.equal(io.last('C', 'coop').data.phase, 'done');
    assert.equal(io.last('TEST', 'room').data.teams.red.done, 1);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('🪣 Bilge pump: take turns; pumping out of turn jams it', () => {
  const clock = fakeClock();
  try {
    const { room, p } = coopGame();
    const t = ensure(room, 'red', 'pump');
    standAt(p('A'), t.x, t.y);
    standAt(p('C'), t.x, t.y);
    room.startTask('A', t.id);
    room.startTask('C', t.id);
    assert.equal(t.session.turn, 'A', 'the caller goes first');
    room.coopInput('C', { action: 'pump' }); // not C's turn
    assert.equal(t.session.pumps, 0);
    assert.equal(room.coopInput('A', { action: 'pump' }), 'Jammed!');
    clock.advance(COOP.JAM_MS + 10);
    for (let i = 0; i < COOP.PUMPS; i++) {
      const who = i % 2 ? 'C' : 'A';
      assert.equal(t.session.turn, who);
      room.coopInput(who, { action: 'pump' });
      clock.advance(200);
    }
    assert.equal(t.done, true);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('🔑 Two-Key Vault: one at each lock, keys turned within 6 seconds', () => {
  const clock = fakeClock();
  try {
    const { room, io, p } = coopGame();
    const t = ensure(room, 'red', 'vault');
    standAt(p('A'), t.x, t.y);
    room.startTask('A', t.id);
    // The helper is sent to the other lock
    const call = io.last('C', 'coopCalls').data[0];
    assert.deepEqual([call.x, call.y], [t.x2, t.y2]);
    standAt(p('C'), t.x, t.y);
    assert.match(room.startTask('C', t.id).error, /other one/);
    standAt(p('C'), t.x2, t.y2);
    assert.equal(room.startTask('C', t.id).error, null);
    // Too slow: the first key springs back
    room.coopInput('A', { action: 'turn' });
    runTicks(room, clock, COOP.VAULT_MS + 200);
    assert.equal(t.turned[0], 0, 'key did not spring back');
    room.coopInput('C', { action: 'turn' });
    assert.ok(!t.done);
    runTicks(room, clock, 3000);
    room.coopInput('A', { action: 'turn' });
    assert.equal(t.done, true);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('leaving: the other one keeps waiting; the last one out ends the call (with a short cooldown)', () => {
  const clock = fakeClock();
  try {
    const { room, io, p } = coopGame();
    const t = ensure(room, 'red', 'sail');
    standAt(p('A'), t.x, t.y);
    standAt(p('C'), t.x, t.y);
    room.startTask('A', t.id);
    const ping = t.session.ping;
    room.startTask('C', t.id);
    room.cancelTask('A'); // the caller walks off; C now waits and calls
    assert.equal(t.session.phase, 'waiting');
    assert.equal(t.session.callerId, 'C');
    assert.ok(t.session.ping > ping);
    assert.equal(io.last('A', 'coopCalls').data[0].callerId, 'C');
    // Walking away also counts as leaving
    standAt(p('C'), t.x, t.y);
    room.handleMove('C', t.x + 200, t.y);
    runTicks(room, clock, 100);
    room.handleMove('C', t.x + 300, t.y);
    assert.equal(t.session, null, 'still calling after walking away');
    assert.equal(io.last('A', 'coopEnd').data.reason, 'left');
    standAt(p('C'), t.x, t.y);
    assert.match(room.startTask('C', t.id).error, /Wait a moment/);
    clock.advance(COOP.COOLDOWN_MS);
    assert.equal(room.startTask('C', t.id).error, null);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('nobody answers for 20s: one reminder; sabotage knocks a pirate out of the co-op task', () => {
  const clock = fakeClock();
  try {
    const { room, io, p } = coopGame();
    const t = ensure(room, 'red', 'sail');
    standAt(p('A'), t.x, t.y);
    room.startTask('A', t.id);
    const ping = io.last('C', 'coopCalls').data[0].ping;
    runTicks(room, clock, COOP.REMIND_MS + 100);
    assert.equal(io.last('C', 'coopCalls').data[0].ping, ping + 1);
    runTicks(room, clock, COOP.REMIND_MS + 100);
    assert.equal(io.last('C', 'coopCalls').data[0].ping, ping + 1, 'reminded more than once');
    standAt(p('C'), t.x, t.y);
    room.startTask('C', t.id);
    p('B').pickup = 'net';
    room.usePickup('B', 'C');
    assert.equal(io.last('C', 'interrupt').ev, 'interrupt');
    assert.equal(t.session.phase, 'waiting', 'A should be waiting again');
    assert.deepEqual(t.session.members.map(m => m.id), ['A']);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('anchor on a co-op task knocks both pirates out', () => {
  const { room, io, p } = coopGame();
  const t = ensure(room, 'red', 'sail');
  room.teamTasks.red.forEach(x => { if (x !== t) x.done = true; });
  standAt(p('A'), t.x, t.y);
  standAt(p('C'), t.x, t.y);
  room.startTask('A', t.id);
  room.startTask('C', t.id);
  p('B').pickup = 'anchor';
  assert.equal(room.usePickup('B', 'A'), null);
  assert.ok(t.lockedUntil > Date.now());
  assert.equal(t.session, null);
  assert.ok(io.last('A', 'interrupt') && io.last('C', 'interrupt'));
  room.stopTimers();
});

test('a crew left with one pirate can still finish co-op tasks alone', () => {
  const clock = fakeClock();
  try {
    const { room, p } = coopGame();
    room.removePlayer('C'); // red is just A now
    const sail = ensure(room, 'red', 'sail');
    standAt(p('A'), sail.x, sail.y);
    room.startTask('A', sail.id);
    assert.equal(sail.session.phase, 'active');
    room.coopInput('A', { action: 'hold', on: true });
    runTicks(room, clock, COOP.SAIL_UP_MS * 2 + 200);
    assert.equal(sail.done, true);
    // Vault: turn one key, run to the other one in time
    const vault = room.teamTasks.red.find(x => x.coop && !x.done) || ensure(room, 'red', 'vault');
    if (vault.type !== 'vault') return room.stopTimers();
    standAt(p('A'), vault.x, vault.y);
    room.startTask('A', vault.id);
    room.coopInput('A', { action: 'turn' });
    assert.equal(p('A').activeTask, null, 'should be sent to the other lock');
    runTicks(room, clock, 8000);
    standAt(p('A'), vault.x2, vault.y2);
    room.startTask('A', vault.id);
    room.coopInput('A', { action: 'turn' });
    assert.equal(vault.done, true);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('a bot answers your call, comes over and holds the sail with you', () => {
  const clock = fakeClock();
  try {
    const { room, io } = makeRoom(['H'], { options: { mode: 'team', botCount: 3, taskCount: 4, botLevel: 'hard' } });
    room.start('H');
    clearTimeout(room.countdownTimer);
    room.state = 'playing';
    room.nextEventAt = Infinity;
    room.nextBarrelAt = Infinity;
    room.nextKeyAt = Infinity;
    room.barrels = [];
    const h = room.players.get('H');
    const t = ensure(room, h.team, 'sail');
    standAt(h, t.x, t.y);
    room.startTask('H', t.id);
    assert.equal(room.coopInput('H', { action: 'hold', on: true }), 'Not now.', 'held before anyone came');
    let ticks = 0;
    while (!t.done && ticks < 20 * 60) {
      runTicks(room, clock, 50);
      h.x = t.x; h.y = t.y;
      if (t.session && t.session.phase === 'active' && !t.session.hold.H) room.coopInput('H', { action: 'hold', on: true });
      ticks++;
    }
    assert.ok(t.done, 'the bot never helped');
    const mate = room.players.get(t.doneWith);
    assert.ok(mate && mate.isBot && mate.team === h.team);
    assert.ok(io.sent.some(s => s.id === 'H' && s.ev === 'coopCalls' && s.data.length && s.data[0].coming.includes(mate.id)), 'bot never said it was coming');
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('an all-bot crew finishes its co-op tasks and can win', () => {
  const clock = fakeClock();
  try {
    const { room } = makeRoom(['H'], { options: { mode: 'team', botCount: 3, taskCount: 6 } });
    room.start('H');
    clearTimeout(room.countdownTimer);
    room.state = 'playing';
    room.nextEventAt = Infinity;
    const h = room.players.get('H');
    const botCrew = h.team === 'red' ? 'blue' : 'red';
    assert.equal(room.teamTasks[botCrew].filter(t => t.coop).length, 2);
    let ticks = 0;
    while (room.state === 'playing' && ticks < 20 * 600) { runTicks(room, clock, 50); ticks++; }
    assert.equal(room.state, 'ended', 'nobody finished');
    assert.ok(room.teamTasks[room.winnerTeam].filter(t => t.coop).every(t => t.done));
    room.stopTimers();
  } finally {
    clock.restore();
  }
});
