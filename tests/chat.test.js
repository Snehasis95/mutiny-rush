// Chat: cleaning, length limit, spam limit, history for newcomers.
const test = require('node:test');
const assert = require('node:assert');
const { makeRoom, fakeClock, token } = require('./helpers');

test('messages are sent to the whole room, tidied up', () => {
  const { room, io } = makeRoom(['A', 'B']);
  assert.equal(room.chat('A', '  ahoy\u0007   there\n crew  '), null);
  const msg = io.last('TEST', 'chat').data;
  assert.equal(msg.text, 'ahoy there crew');
  assert.equal(msg.id, 'A');
  assert.equal(msg.name, 'A');
  assert.ok(msg.color);
  room.stopTimers();
});

test('empty, non-text and over-long messages', () => {
  const { room, io } = makeRoom(['A']);
  assert.ok(room.chat('A', '   '), 'sent an empty message');
  assert.ok(room.chat('A', { evil: true }), 'sent an object');
  room.chat('A', 'x'.repeat(500));
  assert.equal(io.last('TEST', 'chat').data.text.length, 120);
  room.stopTimers();
});

test('spam limit: 5 messages per 5 seconds', () => {
  const clock = fakeClock();
  try {
    const { room } = makeRoom(['A']);
    for (let i = 0; i < 5; i++) assert.equal(room.chat('A', 'msg ' + i), null);
    assert.match(room.chat('A', 'one too many'), /Slow down/);
    clock.advance(5100);
    assert.equal(room.chat('A', 'fine again'), null);
    room.stopTimers();
  } finally {
    clock.restore();
  }
});

test('newcomers and rejoiners get the last 30 messages', () => {
  const { room, io } = makeRoom(['A']);
  for (let i = 0; i < 35; i++) {
    room.players.get('A').chatTimes = []; // skip the spam limit for this test
    room.chat('A', 'line ' + i);
  }
  room.addPlayer('B', 'B', token('B'), 'B');
  const hist = io.last('B', 'chatHistory').data;
  assert.equal(hist.length, 30);
  assert.equal(hist[0].text, 'line 5');
  assert.equal(hist[29].text, 'line 34');
  room.stopTimers();
});

test('chat works during the race too, and bots never talk', () => {
  const { room, io } = makeRoom(['H', 'B'], { playing: true });
  assert.equal(room.chat('B', 'gg'), null);
  assert.equal(io.last('TEST', 'chat').data.text, 'gg');
  const r2 = makeRoom(['H'], { options: { botCount: 1 } });
  const bot = [...r2.room.players.values()].find(p => p.isBot);
  assert.ok(r2.room.chat(bot.id, 'beep'), 'a bot chatted');
  room.stopTimers();
  r2.room.stopTimers();
});
