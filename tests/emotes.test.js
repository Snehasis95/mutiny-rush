// Emotes: everyone sees them, a short cooldown, not mid-task or in a hatch; bots join in.
const test = require('node:test');
const assert = require('node:assert');
const { makeRoom, fakeClock, runTicks } = require('./helpers');
const emotes = require('../shared/emotes');

test('an emote goes to the whole room; unknown ones are refused', () => {
  const { room, io } = makeRoom(['A', 'B']);
  assert.equal(room.emote('A', 'dance'), null);
  assert.deepEqual(io.last('TEST', 'emote').data, { id: 'A', e: 'dance' });
  assert.equal(room.emote('B', 'moonwalk'), 'Unknown emote.');
  room.stopTimers();
});

test('cooldown between emotes', () => {
  const clock = fakeClock();
  try {
    const { room } = makeRoom(['A']);
    assert.equal(room.emote('A', 'wave'), null);
    assert.match(room.emote('A', 'laugh'), /Easy there/);
    clock.advance(emotes.COOLDOWN_MS);
    assert.equal(room.emote('A', 'laugh'), null);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('works in the race, but not in the middle of a task or inside a hatch', () => {
  const { room, p } = makeRoom(['A', 'B'], { playing: true });
  assert.equal(room.emote('A', 'arr'), null);
  const t = p('B').tasks[0];
  p('B').x = t.x; p('B').y = t.y;
  room.startTask('B', t.id);
  assert.match(room.emote('B', 'spin'), /Finish your task/);
  p('A').inHatch = 'h-cabin';
  p('A').emoteAt = 0;
  assert.match(room.emote('A', 'gg'), /hatch/);
  room.stopTimers();
});

test('bots dance in the lobby now and then, and celebrate at the end', () => {
  const clock = fakeClock();
  try {
    const { room, io } = makeRoom(['H'], { options: { botCount: 2 } });
    for (let i = 0; i < 20 * 90; i++) { clock.advance(50); room.lobbyTick(); }
    const botIds = new Set([...room.players.values()].filter(q => q.isBot).map(q => q.id));
    assert.ok(io.sent.some(s => s.ev === 'emote' && botIds.has(s.data.id)), 'bots never emoted in the lobby');
    io.sent.length = 0;
    room.start('H');
    clearTimeout(room.countdownTimer);
    room.state = 'playing';
    room.nextEventAt = Infinity;
    clock.advance(emotes.COOLDOWN_MS);
    const bot = [...room.players.values()].find(q => q.isBot);
    room.end(bot.id);
    const moves = io.sent.filter(s => s.ev === 'emote').map(s => s.data);
    assert.ok(moves.some(m => m.id === bot.id && m.e === 'dance'), 'the winning bot did not dance');
    room.stopTimers();
  } finally {
    clock.restore();
  }
});
