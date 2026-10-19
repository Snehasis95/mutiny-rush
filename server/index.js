const path = require('path');
const http = require('http');
const os = require('os');
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

io.on('connection', socket => {
  let room = null;

  function leave() {
    if (!room) return;
    socket.leave(room.code);
    room.removePlayer(socket.id);
    if (room.isEmpty()) rooms.delete(room.code);
    room = null;
  }

  socket.on('createRoom', (data, ack) => {
    if (typeof ack !== 'function') return;
    leave();
    const code = makeCode();
    room = new Room(io, code);
    rooms.set(code, room);
    socket.join(code);
    room.addPlayer(socket.id, cleanName(data && data.name));
    ack({ ok: true, code });
  });

  socket.on('joinRoom', (data, ack) => {
    if (typeof ack !== 'function') return;
    const code = String((data && data.code) || '').trim().toUpperCase();
    const target = rooms.get(code);
    if (!target) return ack({ ok: false, error: 'No room with that code.' });
    const err = target.joinError();
    if (err) return ack({ ok: false, error: err });
    leave();
    room = target;
    socket.join(code);
    room.addPlayer(socket.id, cleanName(data && data.name));
    ack({ ok: true, code });
  });

  socket.on('setColor', color => room && room.setColor(socket.id, color));
  socket.on('setOption', data => data && room && room.setOption(socket.id, data.key, data.value));
  socket.on('startGame', () => room && room.start(socket.id));
  socket.on('backToLobby', () => room && room.backToLobby(socket.id));
  socket.on('move', data => data && room && room.handleMove(socket.id, data.x, data.y));

  socket.on('startTask', (type, ack) => {
    if (typeof ack !== 'function') return;
    const res = room ? room.startTask(socket.id, type) : { error: 'Not in a room.' };
    ack({ ok: !res.error, ...res });
  });
  socket.on('completeTask', (type, ack) => {
    if (typeof ack !== 'function') return;
    const error = room ? room.completeTask(socket.id, type) : 'Not in a room.';
    ack({ ok: !error, error });
  });
  socket.on('cancelTask', () => room && room.cancelTask(socket.id));

  socket.on('grabBarrel', (barrelId, ack) => {
    if (typeof ack !== 'function') return;
    const res = room ? room.grabBarrel(socket.id, barrelId) : { error: 'Not in a room.' };
    ack({ ok: !res.error, ...res });
  });
  socket.on('usePickup', (targetId, ack) => {
    if (typeof ack !== 'function') return;
    const error = room ? room.usePickup(socket.id, targetId) : 'Not in a room.';
    ack({ ok: !error, error });
  });
  socket.on('hatch', (data, ack) => {
    if (typeof ack !== 'function' || !data) return;
    let error = 'Not in a room.';
    if (room) {
      if (data.action === 'enter') error = room.enterHatch(socket.id, data.id);
      else if (data.action === 'travel') error = room.travelHatch(socket.id, data.id);
      else if (data.action === 'exit') error = room.exitHatch(socket.id);
      else error = 'Unknown action.';
    }
    ack({ ok: !error, error });
  });
  socket.on('leaveRoom', leave);
  socket.on('disconnect', leave);
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

server.listen(PORT, '0.0.0.0', () => {
  console.log('\nMutiny Rush server running');
  console.log(`   On this PC:        http://localhost:${PORT}`);
  if (lanIp()) console.log(`   Phones (same Wi-Fi): http://${lanIp()}:${PORT}`);
  console.log('');
});
