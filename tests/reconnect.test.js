// End-to-end: a real server with pretend phones joining, dropping out and rejoining.
process.env.MR_RECONNECT_GRACE_MS = '1500'; // instead of 45s, so the test is quick

const test = require('node:test');
const assert = require('node:assert');
const { io } = require('socket.io-client');
const server = require('../server/index');

const wait = ms => new Promise(r => setTimeout(r, ms));
const tok = n => `tok${n}`.padEnd(24, 'x');
let url;
const sockets = [];

function phone() {
  const s = io(url, { reconnection: false, forceNew: true });
  sockets.push(s);
  s.data = { pos: {} };
  s.on('room', r => (s.data.room = r));
  s.on('you', y => (s.data.you = y));
  s.on('tasks', t => (s.data.tasks = t));
  s.on('me', m => (s.data.me = m));
  s.on('correct', c => (s.data.corrected = c));
  s.on('state', ({ p }) => p.forEach(([id, x, y]) => (s.data.pos[id] = { x, y })));
  return new Promise(r => s.on('connect', () => r(s)));
}
const ask = (s, ev, d) => new Promise(r => s.emit(ev, d, r));

test.before(async () => {
  const port = await server.start(0);
  url = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  sockets.forEach(s => s.disconnect());
  await server.stop();
});

test('joining: codes, tokens and full rooms', async () => {
  const A = await phone();
  const made = await ask(A, 'createRoom', { name: 'Rahul', token: tok('A') });
  assert.ok(made.ok && /^[A-Z]{4}$/.test(made.code));
  const B = await phone();
  assert.equal((await ask(B, 'joinRoom', { code: 'QQQQ', name: 'X', token: tok('B') })).ok, false, 'joined a missing room');
  assert.equal((await ask(B, 'joinRoom', { code: made.code, name: 'NoToken' })).ok, false, 'joined without a token');
  assert.ok((await ask(B, 'joinRoom', { code: made.code.toLowerCase(), name: 'Priya', token: tok('B') })).ok);
  await wait(100);
  assert.equal(A.data.room.players.length, 2);
  assert.notEqual(B.data.you.id, B.id, 'player id should not be the connection id');
  A.emit('leaveRoom');
  B.emit('leaveRoom');
});

test('a dropped player keeps their pirate and gets it back on a new connection', async () => {
  const A = await phone(), B = await phone(), C = await phone();
  const { code } = await ask(A, 'createRoom', { name: 'Rahul', token: tok('A2') });
  await ask(B, 'joinRoom', { code, name: 'Priya', token: tok('B2') });
  await ask(C, 'joinRoom', { code, name: 'Aman', token: tok('C2') });
  await wait(100);
  const bId = B.data.you.id;
  A.emit('startGame');
  await wait(3400);
  assert.equal(A.data.room.state, 'playing');
  const tasks = B.data.tasks.map(t => t.stationId).join();
  const start = A.data.room.players.find(p => p.id === bId);
  B.emit('move', { x: start.x + 15, y: start.y });
  await wait(150);

  B.disconnect();
  await wait(300);
  let bInfo = A.data.room.players.find(p => p.id === bId);
  assert.ok(bInfo, 'removed straight away');
  assert.equal(bInfo.connected, false);
  assert.ok(bInfo.status.includes('offline'));
  assert.equal(bInfo.blocked.slime, 'Offline', 'offline player can be sabotaged');

  const B2 = await phone();
  const r = await ask(B2, 'rejoin', { code, token: tok('B2') });
  await wait(300);
  assert.ok(r.ok && r.rejoined);
  assert.equal(B2.data.you.id, bId, 'came back as a different pirate');
  assert.equal(B2.data.tasks.map(t => t.stationId).join(), tasks, 'tasks changed');
  assert.ok(Math.abs(B2.data.corrected.x - (start.x + 15)) < 2, 'position lost');
  bInfo = A.data.room.players.find(p => p.id === bId);
  assert.equal(bInfo.connected, true);
  assert.equal(A.data.room.players.length, 3);

  B2.emit('move', { x: start.x + 30, y: start.y });
  await wait(250);
  assert.ok(A.data.pos[bId].x > start.x + 20, 'moves ignored after rejoining');

  assert.equal((await ask(await phone(), 'rejoin', { code, token: tok('nobody') })).ok, false, 'wrong token accepted');

  // A second tab takes over; the old connection can no longer act.
  const B3 = await phone();
  await ask(B3, 'rejoin', { code, token: tok('B2') });
  await wait(150);
  B2.emit('move', { x: start.x + 200, y: start.y });
  await wait(250);
  assert.ok(A.data.pos[bId].x < start.x + 100, 'old connection still moved the pirate');
  B2.disconnect();
  await wait(200);
  assert.equal(A.data.room.players.find(p => p.id === bId).connected, true, 'closing the old tab marked them offline');

  C.emit('leaveRoom');
  await wait(200);
  assert.ok(!A.data.room.players.some(p => p.name === 'Aman'), 'leave was not immediate');

  // Away for longer than the grace period: removed for good.
  B3.disconnect();
  await wait(2000);
  assert.ok(!A.data.room.players.some(p => p.id === bId), 'still there after the grace period');
  assert.equal((await ask(await phone(), 'rejoin', { code, token: tok('B2') })).ok, false, 'rejoined too late');
  A.emit('leaveRoom');
});
