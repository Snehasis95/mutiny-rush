// Gives each player one station per chosen task type, keeping walking distance roughly equal
// and spreading players across different stations where possible.
const map = require('../shared/map');
const { types, stations } = require('../shared/tasks');

const SAMPLES = 1500;     // random station combos looked at per game
const FAIR_BAND = 0.06;   // combos within 6% of the median walk count as fair

// Greedy nearest-next walk from the spawn point through all stations.
function tourLength(list) {
  let x = map.spawn.x, y = map.spawn.y, total = 0;
  const left = list.slice();
  while (left.length) {
    let best = 0, bestD = Infinity;
    left.forEach((s, i) => {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) { bestD = d; best = i; }
    });
    total += bestD;
    ({ x, y } = left[best]);
    left.splice(best, 1);
  }
  return total;
}

const pick = list => list[Math.floor(Math.random() * list.length)];

// Picks `count` task types at random (everyone in the game gets the same types).
function pickTypes(count) {
  const ids = types.map(t => t.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, count);
}

function assign(playerCount, typeIds) {
  const byType = typeIds.map(id => stations.filter(s => s.type === id));

  // Sample random combos (one station per type) and keep the ones with a typical walk length.
  const seen = new Set();
  const combos = [];
  for (let i = 0; i < SAMPLES; i++) {
    const list = byType.map(pick);
    const key = list.map(s => s.id).join();
    if (seen.has(key)) continue;
    seen.add(key);
    combos.push({ list, len: tourLength(list) });
  }
  combos.sort((a, b) => a.len - b.len);
  const median = combos[Math.floor(combos.length / 2)].len;
  let fair = combos.filter(c => Math.abs(c.len - median) <= median * FAIR_BAND);
  if (fair.length < playerCount) fair = combos; // tiny games: just use everything

  // Hand out combos, preferring stations nobody else has yet.
  const used = new Map();
  const result = [];
  for (let i = 0; i < playerCount; i++) {
    let best = null, bestScore = Infinity;
    for (let k = 0; k < 300; k++) {
      const c = pick(fair);
      const score = c.list.reduce((n, s) => n + (used.get(s.id) || 0), 0);
      if (score < bestScore) { best = c; bestScore = score; }
      if (score === 0) break;
    }
    for (const s of best.list) used.set(s.id, (used.get(s.id) || 0) + 1);
    result.push(best.list);
  }
  return result;
}

module.exports = { assign, pickTypes, tourLength };
