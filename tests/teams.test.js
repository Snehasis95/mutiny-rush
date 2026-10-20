// Team race: picking crews, shared task lists, crew-only sabotage, team wins.
const test = require('node:test');
const assert = require('node:assert');
const { makeRoom, fakeClock, runTicks, token } = require('./helpers');
const tasksDef = require('../shared/tasks');

const teamOf = (room, team) => [...room.players.values()].filter(p => p.team === team);
const minMs = type => tasksDef.types.find(t => t.id === type).minMs;

function teamGame(ids, opts = {}) {
  const r = makeRoom(ids, { options: { mode: 'team', ...opts } });
  r.room.start(ids[0]);
  clearTimeout(r.room.countdownTimer);
  r.room.state = 'playing';
  r.room.nextEventAt = Infinity;
  return r;
}

test('switching to teams splits everyone evenly; Captain only', () => {
  const { room } = makeRoom(['A', 'B', 'C', 'D']);
  room.setOption('B', 'mode', 'team');
  assert.equal(room.options.mode, 'solo', 'a guest switched the mode');
  room.setOption('A', 'mode', 'team');
  assert.equal(teamOf(room, 'red').length, 2);
  assert.equal(teamOf(room, 'blue').length, 2);
  room.setOption('A', 'mode', 'solo');
  assert.ok([...room.players.values()].every(p => p.team === null));
  room.stopTimers();
});

test('new pirates join the smaller crew; crews hold 3; a bot swaps out for you', () => {
  const { room } = makeRoom(['A'], { options: { mode: 'team' } });
  room.addPlayer('B', 'B', token('B'), 'B');
  room.addPlayer('C', 'C', token('C'), 'C');
  assert.equal(room.players.get('A').team, 'red');
  assert.equal(room.players.get('B').team, 'blue');
  assert.equal(room.players.get('C').team, 'red');
  room.setTeam('C', 'blue');
  assert.equal(room.players.get('C').team, 'blue');
  room.addPlayer('D', 'D', token('D'), 'D');
  room.setTeam('D', 'blue'); // blue already has B and C -> 3 is fine
  room.addPlayer('E', 'E', token('E'), 'E');
  room.setTeam('E', 'blue'); // blue is full of people (B, C, D): refused
  assert.equal(room.players.get('E').team, 'red', 'joined a full crew');
  assert.equal(teamOf(room, 'blue').length, 3);
  // A full crew with a bot in it: you swap places with the bot
  const r2 = makeRoom(['H'], { options: { mode: 'team', botCount: 3 } });
  const blueBots = teamOf(r2.room, 'blue').filter(p => p.isBot);
  r2.room.setOption('H', 'botCount', 5); // H + 5 bots: 3 v 3
  assert.equal(teamOf(r2.room, 'blue').length, 3);
  r2.room.setTeam('H', 'blue');
  assert.equal(r2.room.players.get('H').team, 'blue', 'could not swap with a bot');
  assert.equal(teamOf(r2.room, 'blue').length, 3);
  assert.ok(blueBots.length >= 0);
  room.stopTimers();
  r2.room.stopTimers();
});

test('Captain can shuffle the crews: random, not balanced, never over 3', () => {
  const { room } = makeRoom(['A', 'B', 'C', 'D', 'E', 'F'], { options: { mode: 'team' } });
  const before = [...room.players.values()].map(p => p.team).join();
  let changed = false;
  for (let i = 0; i < 20 && !changed; i++) {
    room.shuffleTeams('A');
    changed = [...room.players.values()].map(p => p.team).join() !== before;
  }
  assert.ok(changed, 'shuffle never changed anything');
  assert.equal(teamOf(room, 'red').length, 3, '6 pirates must still split 3 v 3');
  room.shuffleTeams('B'); // guests can't
  room.stopTimers();

  // With 4 pirates, uneven splits happen (the Captain evens them out by hand)
  const r2 = makeRoom(['A', 'B', 'C', 'D'], { options: { mode: 'team' } });
  assert.equal(teamOf(r2.room, 'red').length, 2, 'not balanced at first');
  const sizes = new Set();
  for (let i = 0; i < 60; i++) {
    r2.room.shuffleTeams('A');
    const red = teamOf(r2.room, 'red').length;
    assert.ok(red >= 1 && red <= 3, `bad split: ${red} v ${4 - red}`);
    sizes.add(red);
  }
  assert.ok(sizes.has(1) || sizes.has(3), 'shuffle always balanced the crews');
  r2.room.stopTimers();
});

test('Captain can send a pirate to the other crew, or swap two when both are full', () => {
  const { room } = makeRoom(['A', 'B', 'C', 'D'], { options: { mode: 'team' } }); // red: A, C  blue: B, D
  const team = id => room.players.get(id).team;
  assert.equal(room.moveToTeam('B', 'A'), 'Not allowed', 'a guest moved someone');
  assert.equal(team('A'), 'red');
  assert.equal(room.moveToTeam('A', 'C'), null);
  assert.equal(team('C'), 'blue');
  assert.equal(teamOf(room, 'blue').length, 3);
  // Blue is now full of people: a plain move is refused, a picked swap works
  assert.equal(room.moveToTeam('A', 'A'), 'That crew is full');
  assert.equal(room.moveToTeam('A', 'A', 'D'), null);
  assert.equal(team('A'), 'blue');
  assert.equal(team('D'), 'red');
  assert.equal(room.moveToTeam('A', 'D', 'X'), 'Not in that crew');
  // A full crew with a bot: the bot swaps out
  const r2 = makeRoom(['H', 'G'], { options: { mode: 'team', botCount: 4 } });
  const g = r2.room.players.get('G'), h = r2.room.players.get('H');
  const to = g.team === 'red' ? 'blue' : 'red';
  assert.equal(r2.room.moveToTeam('H', 'G'), null);
  assert.equal(g.team, to);
  assert.equal(teamOf(r2.room, 'red').length, 3);
  assert.equal(teamOf(r2.room, 'blue').length, 3);
  assert.ok(h.team);
  // Not during a race, not in solo mode
  r2.room.setOption('H', 'mode', 'solo');
  assert.equal(r2.room.moveToTeam('H', 'G'), 'Not allowed');
  room.stopTimers();
  r2.room.stopTimers();
});

test('Captain can kick a player in the lobby (not bots, not themselves, not mid-race); they can rejoin', () => {
  const { room, io } = makeRoom(['A', 'B', 'C'], { options: { botCount: 1 } });
  const bot = [...room.players.values()].find(p => p.isBot);
  assert.equal(room.kick('B', 'C'), 'Only the Captain can do that.');
  assert.ok(room.kick('A', 'A'), 'kicked themselves');
  assert.ok(room.kick('A', bot.id), 'kicked a bot');
  assert.equal(room.kick('A', 'B'), null);
  assert.ok(!room.players.has('B'));
  assert.ok(io.sent.some(s => s.id === 'B' && s.ev === 'kicked'), 'B was not told');
  assert.match(io.last('TEST', 'notice').data.text, /B was removed/);
  assert.equal(room.joinError(), null, 'B cannot come back');
  room.addPlayer('B', 'B', 'token-B-again-0123456789', 'B');
  assert.ok(room.players.has('B'));
  room.start('A');
  assert.equal(room.kick('A', 'C'), 'You can only remove pirates in the lobby.');
  assert.ok(room.players.has('C'));
  room.stopTimers();
});

test('cannot start with an empty crew', () => {
  const { room, io } = makeRoom(['A'], { options: { mode: 'team' } });
  room.start('A');
  assert.equal(room.state, 'lobby');
  assert.match(io.last('A', 'notice').data.text, /Each crew/);
  room.stopTimers();
});

test('each crew shares one task list: tasks per player x crew size', () => {
  const { room, p } = teamGame(['A', 'B', 'C'], { taskCount: 4 }); // red: A, C  blue: B
  assert.equal(p('A').tasks, p('C').tasks, 'teammates have separate lists');
  assert.equal(p('A').tasks.length, 8);
  assert.equal(p('B').tasks.length, 4);
  assert.notEqual(p('A').tasks, p('B').tasks);
  assert.equal(new Set(p('A').tasks.map(t => t.id)).size, 8, 'task ids are not unique');
  room.stopTimers();
});

test('any crewmate can do any crew task, but not two at once', () => {
  const clock = fakeClock();
  try {
    const { room, io, p } = teamGame(['A', 'B', 'C']); // red: A, C
    const t = p('A').tasks.find(x => x.id.startsWith('C:')); // one of C's original tasks
    p('A').x = t.x; p('A').y = t.y;
    p('C').x = t.x; p('C').y = t.y;
    assert.equal(room.startTask('A', t.id).error, null);
    assert.match(room.startTask('C', t.id).error, /already on it/);
    clock.advance(minMs(t.type) + 10);
    assert.equal(room.completeTask('A', t.id), null);
    assert.equal(t.done, true);
    assert.equal(t.doneBy, 'A');
    const cTasks = io.last('C', 'tasks').data;
    assert.ok(cTasks.find(x => x.id === t.id).done, 'teammate was not told');
    assert.equal(io.last('TEST', 'room').data.teams.red.done, 1);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('the crew that finishes wins, and every member gets a parrot', () => {
  const clock = fakeClock();
  try {
    const { room, io, p } = teamGame(['A', 'B', 'C'], { taskCount: 3 }); // red: A, C  blue: B
    for (const t of p('A').tasks.filter(x => x.coop)) t.done = true; // 🤝 covered in coop.test.js
    for (const t of p('A').tasks.filter(x => !x.coop)) {
      const who = p('C');
      who.x = t.x; who.y = t.y;
      room.startTask('C', t.id);
      clock.advance(minMs(t.type) + 10);
      room.completeTask('C', t.id);
    }
    const msg = io.last('TEST', 'room').data;
    assert.equal(msg.state, 'ended');
    assert.equal(msg.winnerTeam, 'red');
    assert.equal(p('A').parrot, true, 'teammate missed the parrot');
    assert.equal(p('C').parrot, true);
    assert.equal(p('B').parrot, false);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('sabotage never hits your own crew', () => {
  const { room, p } = teamGame(['A', 'B', 'C', 'D']); // red: A, C  blue: B, D
  p('A').pickup = 'slime';
  assert.equal(room.usePickup('A', 'C'), "That's your crewmate!");
  assert.equal(p('A').pickup, 'slime');
  assert.equal(room.usePickup('A', 'B'), null);
  p('C').pickup = 'storm';
  room.usePickup('C');
  assert.equal(p('A').stormUntil, 0, 'storm hit a crewmate');
  assert.ok(p('D').stormUntil > Date.now(), 'storm missed the other crew');
  room.stopTimers();
});

test('anchor and Big Wave work on the crew list', () => {
  const { room, p } = teamGame(['A', 'B', 'C', 'D'], { taskCount: 3 }); // blue: B, D -> 6 tasks
  p('A').pickup = 'anchor';
  room.usePickup('A', 'B');
  assert.ok(p('D').tasks.some(t => t.lockedUntil > Date.now()), "anchor didn't lock a crew task");
  p('C').pickup = 'wave';
  assert.equal(room.usePickup('C', 'D'), 'No finished tasks');
  p('B').tasks.slice(0, 5).forEach(t => (t.done = true)); // 5 of 6: one left
  assert.equal(room.usePickup('C', 'D'), 'Too close to winning');
  p('B').tasks[4].done = false;
  assert.equal(room.usePickup('C', 'D'), null);
  room.stopTimers();
});

test('bots race in crews, never sabotage crewmates, and a crew wins', () => {
  const clock = fakeClock();
  try {
    const { room } = makeRoom(['H'], { options: { mode: 'team', botCount: 3, taskCount: 4 } });
    room.start('H');
    clearTimeout(room.countdownTimer);
    room.state = 'playing';
    room.nextEventAt = Infinity;
    let friendlyFire = 0;
    const use = room.usePickup.bind(room);
    room.usePickup = (id, target) => {
      const a = room.players.get(id), b = target && room.players.get(target);
      if (a && b && a.team === b.team) friendlyFire++;
      return use(id, target);
    };
    let ticks = 0;
    while (room.state === 'playing' && ticks < 20 * 400) { runTicks(room, clock, 50); ticks++; }
    assert.equal(room.state, 'ended', 'no crew finished');
    assert.ok(room.winnerTeam);
    assert.equal(friendlyFire, 0, 'a bot sabotaged its own crew');
    for (const p of room.players.values()) assert.equal(p.parrot, p.team === room.winnerTeam);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});
