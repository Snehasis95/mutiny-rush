// 🤝 Co-op tasks (Teams only): two crewmates do them together.
// The server runs each co-op mini-game, so both phones always agree on what's happening.
//
// A co-op task's `session` (null while nobody is on it):
//   phase: 'waiting' (one pirate there, calling the crew) | 'active' (two there, playing)
//   callerId, members: [{ id, lock }], coming: [ids answering "On my way!"]
//   sail:  hold { id: true }, progress 0..1
//   pump:  pumps, turn (whose go), jamUntil
//   vault: turned [time lock 0 turned, time lock 1 turned]
const map = require('../shared/map');
const tasksDef = require('../shared/tasks');

const { COOP } = tasksDef;
const typeById = new Map(tasksDef.coopTypes.map(t => [t.id, t]));
const stationOf = new Map(tasksDef.coopStations.map(s => [s.type, s]));
const areaAt = (x, y) => (map.areas.find(a => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h) || {}).name || '';
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const SLACK = 40;
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------- setting up a race ----------------

// How many co-op tasks each crew gets.
const coopCount = taskCount => (taskCount >= 6 ? 2 : 1);

// Swaps some of each crew's normal tasks for co-op ones (same types for both crews, so it's fair).
// A crew of one gets none.
function addTasks(room) {
  if (!room.teamTasks) return;
  const kinds = shuffle(tasksDef.coopTypes.map(t => t.id)).slice(0, coopCount(room.options.taskCount));
  for (const [team, list] of Object.entries(room.teamTasks)) {
    if (room.teamMembers(team).length < 2) continue;
    for (const type of kinds) {
      const s = stationOf.get(type);
      // Replace a random normal task, so the list stays the same length.
      const normal = list.filter(t => !t.coop);
      list.splice(list.indexOf(normal[Math.floor(Math.random() * normal.length)]), 1);
      list.push({
        id: `${team}:coop:${type}`, type, coop: true, stationId: `coop-${type}`,
        x: s.x, y: s.y, area: areaAt(s.x, s.y),
        x2: s.x2 == null ? null : s.x2, y2: s.y2 == null ? null : s.y2, area2: s.x2 == null ? null : areaAt(s.x2, s.y2),
        done: false, lockedUntil: 0, busyBy: null, doneBy: null, doneWith: null, session: null,
        turned: [0, 0], // vault: when each key was turned

      });
    }
  }
}

// ---------------- where to stand ----------------

const locksOf = t => (t.x2 == null ? [{ x: t.x, y: t.y }] : [{ x: t.x, y: t.y }, { x: t.x2, y: t.y2 }]);

// The lock (0 or 1) this pirate is standing at, or -1.
function lockAt(t, p, slack = SLACK) {
  const locks = locksOf(t);
  let best = -1, bestD = tasksDef.USE_DIST + slack;
  locks.forEach((l, i) => { const d = dist(l, p); if (d <= bestD) { best = i; bestD = d; } });
  return best;
}

function spotOf(t, p) {
  const m = t.session && t.session.members.find(x => x.id === p.id);
  return locksOf(t)[m ? m.lock : 0];
}

// Where a helper should go: the other lock for the vault, the same spot otherwise.
function helpSpot(t) {
  const s = t.session;
  if (t.x2 == null || !s) return { x: t.x, y: t.y, area: t.area };
  const callerLock = s.members[0] ? s.members[0].lock : 0;
  return callerLock === 0 ? { x: t.x2, y: t.y2, area: t.area2 } : { x: t.x, y: t.y, area: t.area };
}

// ---------------- joining and leaving ----------------

const crewOf = (room, p) => room.teamMembers(p.team);
const isSolo = (room, p) => crewOf(room, p).length < 2;

function newSession(room, t, p, lock, now) {
  return {
    phase: 'waiting', callerId: p.id, members: [{ id: p.id, lock }], coming: [],
    calledAt: now, remindedAt: 0, ping: 1,
    solo: isSolo(room, p),
    hold: {}, progress: 0, pumps: 0, turn: p.id, jamUntil: 0,
    lastKey: '',
  };
}

// USE on a co-op task: start a call, or join the crewmate who is waiting. Returns an error or null.
function start(room, p, t, now) {
  const lock = lockAt(t, p);
  if (lock < 0) return 'Get closer to the station.';
  const s = t.session;
  if (!s) {
    // The cooldown only stops new calls; joining a crewmate is always fine.
    if (now < (p.coopCooldownUntil || 0)) return 'Wait a moment before calling again.';
    t.session = newSession(room, t, p, lock, now);
    if (t.session.solo) t.session.phase = 'active'; // a crew of one does it alone
    p.activeTask = { taskId: t.id, type: t.type, startedAt: now, coop: true };
    sendCalls(room, p.team);
    sendState(room, t, true);
    room.sendTeamTasks(p);
    return null;
  }
  if (s.members.some(m => m.id === p.id)) return null;
  if (s.members.length >= 2) {
    const names = s.members.map(m => (room.players.get(m.id) || {}).name).join(' and ');
    return `${names} are already on it!`;
  }
  if (t.x2 != null && lock === s.members[0].lock) {
    return `🏦 ${(room.players.get(s.callerId) || {}).name} is at this lock. Use the other one in the ${helpSpot(t).area}!`;
  }
  // Joined: the call is answered.
  s.members.push({ id: p.id, lock });
  s.phase = 'active';
  if (t.type === 'pump') s.turn = s.callerId;
  p.activeTask = { taskId: t.id, type: t.type, startedAt: now, coop: true };
  const others = s.coming.filter(id => id !== p.id);
  s.coming = [];
  for (const q of crewOf(room, p)) room.toPlayer(q, 'coopEnd', { taskId: t.id, type: t.type, reason: 'joined', by: p.id, callerId: s.callerId, wasComing: others.includes(q.id) });
  sendCalls(room, p.team);
  sendState(room, t, true);
  room.sendTeamTasks(p);
  return null;
}

// A pirate stops (cancelled, walked away, knocked out, offline). The other one keeps waiting.
function leave(room, p, t, now) {
  const s = t.session;
  if (!s) return;
  s.members = s.members.filter(m => m.id !== p.id);
  delete s.hold[p.id];
  if (!s.members.length) {
    t.session = null;
    if (!s.solo) t.turned = [0, 0]; // a crew of one keeps its first key turned while running to the other lock
    if (s.phase === 'waiting' && !s.solo) p.coopCooldownUntil = now + COOP.COOLDOWN_MS;
    for (const q of crewOf(room, p)) {
      if (q.id !== p.id) room.toPlayer(q, 'coopEnd', { taskId: t.id, type: t.type, reason: 'left', by: p.id, callerId: p.id, wasComing: s.coming.includes(q.id) });
    }
  } else {
    // Back to waiting: the one who's left calls the crew again.
    const stay = s.members[0];
    s.phase = isSolo(room, p) ? 'active' : 'waiting';
    s.callerId = stay.id;
    s.coming = [];
    s.calledAt = now;
    s.remindedAt = 0;
    s.ping++;
    s.hold = {};
    t.turned = [0, 0];
    s.turn = stay.id;
    sendState(room, t, true);
  }
  sendCalls(room, p.team);
  room.sendTeamTasks(p);
}

// "On my way!" / "Go anyway" (same thing) and ✕ on the chip.
function reply(room, p, taskId, action) {
  const t = p.tasks.find(x => x.id === taskId);
  if (!t || !t.coop || !t.session || t.session.phase !== 'waiting' || t.done) return 'That call is over.';
  const s = t.session;
  if (s.members.some(m => m.id === p.id)) return null;
  if (action === 'coming') {
    if (!s.coming.includes(p.id)) s.coming.push(p.id);
  } else if (action === 'cancel') {
    s.coming = s.coming.filter(id => id !== p.id);
  } else return 'Unknown answer.';
  sendCalls(room, p.team);
  sendState(room, t);
  return null;
}

// ---------------- playing ----------------

// Taps from the co-op mini-game: { action: 'hold', on } | { action: 'pump' } | { action: 'turn' }
function input(room, p, data, now) {
  const t = p.activeTask && p.activeTask.coop && p.tasks.find(x => x.id === p.activeTask.taskId);
  const s = t && t.session;
  if (!s || s.phase !== 'active' || !data) return 'Not now.';
  const me = s.members.find(m => m.id === p.id);
  if (!me) return 'Not now.';
  if (now < p.netUntil) return "🥅 You're tangled in a net!";
  if (t.type === 'sail' && data.action === 'hold') {
    if (data.on) s.hold[p.id] = true;
    else delete s.hold[p.id];
  } else if (t.type === 'pump' && data.action === 'pump') {
    if (now < s.jamUntil) return 'Jammed!';
    if (s.solo) {
      if (now - (s.lastPump || 0) < 350) return null;
      s.lastPump = now;
      s.pumps++;
    } else if (s.turn !== p.id) {
      s.jamUntil = now + COOP.JAM_MS; // out of turn: the pump jams
    } else {
      s.pumps++;
      s.turn = (s.members.find(m => m.id !== p.id) || me).id;
    }
    if (s.pumps >= COOP.PUMPS) return finish(room, t);
  } else if (t.type === 'vault' && data.action === 'turn') {
    const window = s.solo ? COOP.SOLO_VAULT_MS : COOP.VAULT_MS;
    t.turned[me.lock] = now;
    const other = t.turned[1 - me.lock];
    if (other && now - other <= window) return finish(room, t);
    if (s.solo) {
      // On your own: off you go to the other lock (your key stays turned for a while).
      room.toPlayer(p, 'coop', { taskId: t.id, type: t.type, phase: 'soloTurned', ms: window, area: me.lock === 0 ? t.area2 : t.area });
      p.activeTask = null;
      leave(room, p, t, now);
      return null;
    }
  } else {
    return 'Not now.';
  }
  sendState(room, t);
  return null;
}

function finish(room, t) {
  const s = t.session;
  t.done = true;
  t.turned = [0, 0];
  t.doneBy = s.members[0] ? s.members[0].id : null;
  t.doneWith = s.members[1] ? s.members[1].id : null;
  t.session = null;
  const ids = s.members.map(m => m.id);
  for (const id of ids) {
    const q = room.players.get(id);
    if (!q) continue;
    q.activeTask = null;
    room.toPlayer(q, 'coop', { taskId: t.id, type: t.type, phase: 'done' });
  }
  const anyone = room.players.get(ids[0]);
  if (anyone) {
    sendCalls(room, anyone.team);
    room.sendTeamTasks(anyone);
    if (anyone.tasks.every(x => x.done)) room.end(anyone.id);
    else room.broadcast();
  }
  return null;
}

// Every server tick: the sail rises or slips, vault keys spring back, unanswered calls get a reminder.
function tick(room, now, dt) {
  if (!room.teamTasks) return;
  for (const [team, list] of Object.entries(room.teamTasks)) {
    let callsChanged = false;
    for (const t of list) {
      if (t.type === 'vault') {
        const window = t.session && !t.session.solo ? COOP.VAULT_MS : COOP.SOLO_VAULT_MS;
        t.turned = t.turned.map(at => (at && now - at > window ? 0 : at));
      }
      const s = t.session;
      if (!s || t.done) continue;
      if (s.phase === 'active' && t.type === 'sail') {
        const need = s.solo ? 1 : 2;
        const holding = s.members.filter(m => s.hold[m.id] && now >= ((room.players.get(m.id) || {}).netUntil || 0)).length;
        const up = holding >= need;
        const rate = up ? (s.solo ? 0.5 : 1) / COOP.SAIL_UP_MS : -1 / COOP.SAIL_DOWN_MS;
        s.progress = Math.max(0, Math.min(1, s.progress + rate * dt * 1000));
        if (s.progress >= 1) { finish(room, t); continue; }
      }
      if (s.phase === 'waiting' && !s.coming.length && !s.remindedAt && now - s.calledAt >= COOP.REMIND_MS) {
        s.remindedAt = now;
        s.ping++;
        callsChanged = true;
      }
      sendState(room, t);
    }
    if (callsChanged) sendCalls(room, team);
  }
}

// ---------------- messages ----------------

// What crewmates see: every open call on their crew.
function callsFor(room, team) {
  const list = (room.teamTasks && room.teamTasks[team]) || [];
  return list.filter(t => t.session && t.session.phase === 'waiting' && !t.done).map(t => {
    const s = t.session, spot = helpSpot(t);
    return { taskId: t.id, type: t.type, callerId: s.callerId, coming: s.coming.slice(), ping: s.ping, x: spot.x, y: spot.y, area: spot.area };
  });
}

function sendCalls(room, team) {
  if (!team) return;
  const calls = callsFor(room, team);
  for (const q of room.teamMembers(team)) room.toPlayer(q, 'coopCalls', calls);
}

// The live state of one co-op mini-game, for the pirates doing it (sent when something changes).
function sendState(room, t, force = false) {
  const s = t.session;
  if (!s) return;
  const now = Date.now();
  const caller = room.players.get(s.callerId);
  const crew = caller ? crewOf(room, caller).filter(q => !s.members.some(m => m.id === q.id)) : [];
  const state = {
    taskId: t.id, type: t.type, phase: s.phase, solo: s.solo, callerId: s.callerId,
    members: s.members.map(m => ({ id: m.id, lock: m.lock })),
    crew: crew.map(q => ({ id: q.id, status: s.coming.includes(q.id) ? 'coming' : q.activeTask ? 'busy' : 'idle' })),
    target: helpSpot(t),
    areas: [t.area, t.area2], // the room each lock is in
    progress: Math.round(s.progress * 50) / 50,
    hold: Object.keys(s.hold),
    pumps: s.pumps, need: COOP.PUMPS, turn: s.turn,
    jamUntil: s.jamUntil > now ? s.jamUntil : 0,
    turned: t.turned.slice(),
    window: s.solo ? COOP.SOLO_VAULT_MS : COOP.VAULT_MS,
  };
  const key = JSON.stringify(state);
  if (!force && key === s.lastKey) return;
  s.lastKey = key;
  // Timers go out as "ms left" (phones' clocks differ from the server's).
  const out = { ...state, jamMs: state.jamUntil ? state.jamUntil - now : 0, turnedMs: state.turned.map(at => (at ? Math.max(0, at + state.window - now) : 0)) };
  delete out.jamUntil;
  delete out.turned;
  for (const m of s.members) {
    const q = room.players.get(m.id);
    if (q) room.toPlayer(q, 'coop', { ...out, you: m.lock });
  }
}

// Extra fields in each player's task list.
function taskFields(t) {
  if (!t.coop) return {};
  return {
    coop: true, x2: t.x2, y2: t.y2, area2: t.area2, doneWith: t.doneWith,
    session: t.session ? { phase: t.session.phase, callerId: t.session.callerId, members: t.session.members.map(m => m.id) } : null,
  };
}

// Pirates currently on this task (to knock them out, e.g. when it gets anchored).
const workers = t => (t.session ? t.session.members.map(m => m.id) : t.busyBy ? [t.busyBy] : []);

module.exports = {
  addTasks, coopCount, lockAt, spotOf, helpSpot, start, leave, reply, input, tick,
  sendCalls, callsFor, taskFields, workers, typeById,
};
