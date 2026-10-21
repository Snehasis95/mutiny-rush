const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const Room = require('./Room');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// Lets a page opened as "localhost" build share links that phones on the same Wi-Fi can open.
app.get('/api/info', (req, res) => {
  res.json({ lanUrl: lanIp() ? `http://${lanIp()}:${PORT}` : null });
});

const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 12) || 'Pirate';
}

// Players rejoin with a secret token kept in their browser tab.
const cleanToken = t => (typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t) ? t : null);

function newRoom() {
  const code = makeCode();
  const room = new Room(io, code);
  room.onEmpty = () => rooms.delete(code);
  rooms.set(code, room);
  return room;
}

io.on('connection', socket => {
  let room = null;
  let pid = null; // this connection's player id inside `room`

  // Only the player's current connection may act for them.
  const active = () => room && pid && room.players.has(pid) && room.players.get(pid).socketId === socket.id;

  function bind(r, id) {
    room = r;
    pid = id;
    socket.join(r.code);
    // Sent before any room update, so the page knows which pirate is "me".
    socket.emit('you', { id, code: r.code });
  }

  function leave() {
    if (active()) room.removePlayer(pid);
    if (room) socket.leave(room.code);
    room = null;
    pid = null;
  }

  function enter(r, data) {
    const token = cleanToken(data && data.token);
    if (!token) return { ok: false, error: 'Please reload the page and try again.' };
    leave();
    const id = crypto.randomBytes(6).toString('hex');
    bind(r, id);
    r.addPlayer(id, socket.id, token, cleanName(data && data.name), false, data && data.look);
    return { ok: true, code: r.code };
  }

  socket.on('createRoom', (data, ack) => {
    if (typeof ack !== 'function') return;
    ack(enter(newRoom(), data));
  });

  socket.on('joinRoom', (data, ack) => {
    if (typeof ack !== 'function') return;
    const code = String((data && data.code) || '').trim().toUpperCase();
    const target = rooms.get(code);
    if (!target) return ack({ ok: false, error: 'No room with that code.' });
    // Already in this room (e.g. typed the code again after a drop): just reconnect.
    const known = cleanToken(data && data.token) && target.findByToken(data.token);
    if (known) return ack(rejoin(target, known));
    const err = target.joinError();
    if (err) return ack({ ok: false, error: err });
    ack(enter(target, data));
  });

  function rejoin(r, p) {
    if (room !== r || pid !== p.id) leave();
    bind(r, p.id);
    r.reconnectPlayer(p, socket.id);
    return { ok: true, code: r.code, rejoined: true };
  }

  // After a dropped connection or a page reload: get back into the same match.
  socket.on('rejoin', (data, ack) => {
    if (typeof ack !== 'function') return;
    const token = cleanToken(data && data.token);
    const r = rooms.get(String((data && data.code) || '').toUpperCase());
    const p = token && r && r.findByToken(token);
    if (!p) return ack({ ok: false, error: 'That game is over or you were away too long.' });
    ack(rejoin(r, p));
  });

  socket.on('setColor', color => active() && room.setColor(pid, color));
  socket.on('setLook', look => active() && room.setLook(pid, look));
  socket.on('setTeam', team => active() && room.setTeam(pid, team));
  socket.on('chat', (text, ack) => {
    const error = active() ? room.chat(pid, text) : 'Not in a room.';
    if (typeof ack === 'function') ack({ ok: !error, error });
  });
  socket.on('shuffleTeams', () => active() && room.shuffleTeams(pid));
  socket.on('emote', (e, ack) => {
    const error = active() ? room.emote(pid, String(e)) : 'Not in a room.';
    if (typeof ack === 'function') ack({ ok: !error, error });
  });
  socket.on('kick', targetId => active() && room.kick(pid, String(targetId)));
  socket.on('moveTeam', data => data && active() && room.moveToTeam(pid, String(data.id), data.swapWith ? String(data.swapWith) : null));
  socket.on('setOption', data => data && active() && room.setOption(pid, data.key, data.value));
  socket.on('startGame', () => active() && room.start(pid));
  socket.on('backToLobby', () => active() && room.backToLobby(pid));
  socket.on('move', data => data && active() && room.handleMove(pid, data.x, data.y));

  socket.on('startTask', (type, ack) => {
    if (typeof ack !== 'function') return;
    const res = active() ? room.startTask(pid, type) : { error: 'Not in a room.' };
    ack({ ok: !res.error, ...res });
  });
  socket.on('completeTask', (type, ack) => {
    if (typeof ack !== 'function') return;
    const error = active() ? room.completeTask(pid, type) : 'Not in a room.';
    ack({ ok: !error, error });
  });
  socket.on('cancelTask', () => active() && room.cancelTask(pid));
  socket.on('coop', data => active() && room.coopInput(pid, data));
  socket.on('coopReply', data => data && active() && room.coopReply(pid, String(data.taskId), String(data.action)));

  socket.on('grabBarrel', (barrelId, ack) => {
    if (typeof ack !== 'function') return;
    const res = active() ? room.grabBarrel(pid, barrelId) : { error: 'Not in a room.' };
    ack({ ok: !res.error, ...res });
  });
  socket.on('usePickup', (targetId, ack) => {
    if (typeof ack !== 'function') return;
    const error = active() ? room.usePickup(pid, targetId) : 'Not in a room.';
    ack({ ok: !error, error });
  });
  socket.on('hatch', (data, ack) => {
    if (typeof ack !== 'function' || !data) return;
    let error = 'Not in a room.';
    if (active()) {
      if (data.action === 'enter') error = room.enterHatch(pid, data.id);
      else if (data.action === 'travel') error = room.travelHatch(pid, data.id);
      else if (data.action === 'exit') error = room.exitHatch(pid);
      else error = 'Unknown action.';
    }
    ack({ ok: !error, error });
  });

  // Tapping Leave removes you right away; a dropped connection gets a grace period.
  socket.on('leaveRoom', leave);
  socket.on('disconnect', () => {
    if (room && pid) room.disconnectPlayer(pid, socket.id);
  });
});

function lanIp() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) found.push(ni.address);
    }
  }
  return found.find(a => a.startsWith('192.168.')) || found.find(a => a.startsWith('10.')) || found[0] || null;
}

// Starts listening. Tests call this with port 0 to get a free port.
function start(port = PORT) {
  return new Promise(resolve => {
    server.listen(port, '0.0.0.0', () => resolve(server.address().port));
  });
}

function stop() {
  for (const room of rooms.values()) room.stopTimers();
  io.close();
  return new Promise(resolve => server.close(() => resolve()));
}

module.exports = { start, stop, rooms };

// "npm start" / "node server/index.js" runs the game; tests just require this file.
if (require.main === module) {
  start().then(port => {
    console.log('\nMutiny Rush server running');
    console.log(`   On this PC:        http://localhost:${port}`);
    if (lanIp()) console.log(`   Phones (same Wi-Fi): http://${lanIp()}:${port}`);
    console.log('');
  });
}
