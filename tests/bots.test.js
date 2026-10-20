// Bots: route-finding, lobby seats, playing a full race, difficulty levels.
const test = require('node:test');
const assert = require('node:assert');
const { makeRoom, fakeClock, runTicks, token } = require('./helpers');
const bots = require('../server/bots');
const map = require('../shared/map');
const physics = require('../shared/physics');
const { stations } = require('../shared/tasks');

const botsIn = room => [...room.players.values()].filter(p => p.isBot);

test('a bot can find its way to every task station', () => {
  for (const s of stations) {
    const path = bots.findPath(map.spawn, s);
    assert.ok(path, `no route to ${s.id}`);
    let pos = { x: map.spawn.x, y: map.spawn.y };
    for (const wp of path) pos = physics.sweep(pos.x, pos.y, wp.x, wp.y);
    assert.ok(Math.hypot(pos.x - s.x, pos.y - s.y) < 40, `route to ${s.id} ends short`);
  }
});

test('routes go around blocked doorways', () => {
  const door = map.doors[0]; // cabin <-> deck
  const block = [{ x: door.x - 28, y: door.y - 80, w: 56, h: 160 }];
  const target = { x: 130, y: 260 }; // open floor in the Captain's Cabin
  const path = bots.findPath({ x: 900, y: 175 }, target, block);
  assert.ok(path, 'no route at all');
  let pos = { x: 900, y: 175 };
  for (const wp of path) pos = physics.sweep(pos.x, pos.y, wp.x, wp.y, block);
  assert.ok(Math.hypot(pos.x - target.x, pos.y - target.y) < 40, 'did not get round the block');
  assert.ok(path.length > 2, 'went straight through instead of around');
});

test('lobby seats: bots fill up to 6, step aside for people, come back when they leave', () => {
  const { room } = makeRoom(['H']);
  room.setOption('H', 'botCount', 3);
  assert.equal(botsIn(room).length, 3);
  assert.equal(new Set([...room.players.values()].map(p => p.color)).size, room.players.size, 'colors clash');
  assert.equal(room.hostId, 'H');
  room.setOption('H', 'botCount', 9);
  assert.equal(botsIn(room).length, 3, 'accepted 9 bots');
  room.setOption('H', 'botCount', 5);
  assert.equal(room.players.size, 6);
  assert.equal(room.joinError(), null, 'bots made the room look full');
  room.addPlayer('G', 'G', token('G'), 'Guest');
  assert.equal(room.players.size, 6);
  assert.equal(room.humans().length, 2);
  const botColor = botsIn(room)[0].color;
  room.setColor('G', botColor);
  assert.equal(room.players.get('G').color, botColor, 'could not take a bot color');
  room.removePlayer('G');
  assert.equal(room.players.size, 6, 'seat not given back to a bot');
  room.setOption('G', 'botCount', 0);
  assert.equal(botsIn(room).length, 5, 'a guest changed the bot count');
  let closed = false;
  room.onEmpty = () => (closed = true);
  room.removePlayer('H');
  assert.ok(closed && room.players.size === 0, 'room kept running with only bots');
  room.stopTimers();
});

function race(level, botCount = 1, taskCount = 6, withItems = false) {
  const clock = fakeClock();
  try {
    const { room } = makeRoom(['H'], { options: { botLevel: level, botCount, taskCount } });
    room.start('H');
    clearTimeout(room.countdownTimer);
    room.state = 'playing';
    room.nextEventAt = Infinity;
    if (!withItems) { room.nextBarrelAt = Infinity; room.nextKeyAt = Infinity; room.barrels = []; }
    let ticks = 0;
    while (room.state === 'playing' && ticks < 20 * 400) { runTicks(room, clock, 50); ticks++; }
    room.stopTimers();
    return { room, secs: room.state === 'ended' ? ticks / 20 : null };
  } finally {
    clock.restore();
  }
}

test('bots play a whole race: walk, grab barrels, use items and win', () => {
  const clock = fakeClock();
  try {
    const { room } = makeRoom(['H'], { options: { botCount: 2, taskCount: 4 } });
    room.start('H');
    clearTimeout(room.countdownTimer);
    room.state = 'playing';
    room.nextEventAt = Infinity;
    // A barrel right next to a bot, so grabbing is certain to come up in a short race.
    const firstBot = [...room.players.values()].find(p => p.isBot);
    room.barrels.push({ id: 999, x: firstBot.x + 50, y: firstBot.y, kind: 'barrel' });
    let grabbed = 0, used = 0;
    const grab = room.grabBarrel.bind(room), use = room.usePickup.bind(room);
    room.grabBarrel = (...a) => { const r = grab(...a); if (!r.error) grabbed++; return r; };
    room.usePickup = (...a) => { const r = use(...a); if (r === null) used++; return r; };
    let ticks = 0;
    while (room.state === 'playing' && ticks < 20 * 400) { runTicks(room, clock, 50); ticks++; }
    assert.equal(room.state, 'ended', 'nobody won');
    assert.ok(room.players.get(room.winnerId).isBot);
    assert.ok(grabbed > 0, 'bots never grabbed a barrel');
    assert.ok(used > 0, 'bots never used an item');
    room.backToLobby('H');
    assert.equal(botsIn(room).length, 2, 'bots vanished after the game');
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('difficulty: Easy is clearly slower than Normal, Hard clearly faster', () => {
  const avg = level => {
    const times = [1, 2, 3].map(() => race(level).secs);
    assert.ok(times.every(t => t !== null), `${level} bot did not finish`);
    return times.reduce((a, b) => a + b, 0) / times.length;
  };
  const easy = avg('easy'), normal = avg('normal'), hard = avg('hard');
  assert.ok(easy > normal * 1.3, `easy ${easy}s vs normal ${normal}s`);
  assert.ok(hard < normal * 0.85, `hard ${hard}s vs normal ${normal}s`);
});

test('bot level: Captain only, known levels only', () => {
  const { room } = makeRoom(['A', 'B']);
  assert.equal(room.options.botLevel, 'normal');
  room.setOption('A', 'botLevel', 'hard');
  room.setOption('A', 'botLevel', 'insane');
  room.setOption('B', 'botLevel', 'easy');
  assert.equal(room.options.botLevel, 'hard');
  room.stopTimers();
});
