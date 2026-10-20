// Shared helpers for the tests.
const Room = require('../server/Room');

// A stand-in for socket.io that just records what the room sends.
function mockIo() {
  const sent = [];
  return {
    sent,
    to: id => ({ emit: (ev, data) => sent.push({ id, ev, data }) }),
    last(id, ev) {
      return [...sent].reverse().find(s => s.id === id && s.ev === ev);
    },
  };
}

const token = id => `token-${id}-0123456789abcdef`;

// A room with human players (ids = names), optionally already racing.
function makeRoom(ids = ['A', 'B'], { playing = false, options = {} } = {}) {
  const io = mockIo();
  const room = new Room(io, 'TEST');
  for (const id of ids) room.addPlayer(id, id, token(id), id);
  for (const [k, v] of Object.entries(options)) room.setOption(ids[0], k, v);
  if (playing) {
    room.start(ids[0]);
    clearTimeout(room.countdownTimer);
    room.state = 'playing';
    room.nextEventAt = Infinity; // events only when a test asks for them
  }
  return { room, io, p: id => room.players.get(id) };
}

// Replaces Date.now with a clock the test moves forward by hand.
function fakeClock() {
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  return {
    get now() { return now; },
    advance(ms) { now += ms; },
    restore() { Date.now = real; },
  };
}

// Runs room ticks (50ms each) on a fake clock.
function runTicks(room, clock, ms) {
  for (let t = 0; t < ms; t += 50) {
    clock.advance(50);
    room.tick();
  }
}

module.exports = { mockIo, token, makeRoom, fakeClock, runTicks };
