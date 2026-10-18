// Gives each player one station per task type, keeping walking distance roughly equal
// and spreading players across different stations where possible.
const map = require('../shared/map');
const { types, stations } = require('../shared/tasks');

const byType = types.map(t => stations.filter(s => s.type === t.id));

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

// Every combination of one station per type (4^6 = 4096), scored by walking distance.
const combos = [];
(function build(i, acc) {
  if (i === byType.length) return combos.push({ list: acc, len: tourLength(acc) });
  for (const s of byType[i]) build(i + 1, acc.concat(s));
})(0, []);
combos.sort((a, b) => a.len - b.len);
const median = combos[Math.floor(combos.length / 2)].len;
const fair = combos.filter(c => Math.abs(c.len - median) <= median * 0.06);

function assign(playerCount) {
  const used = new Map();
  const result = [];
  for (let i = 0; i < playerCount; i++) {
    let best = null, bestScore = Infinity;
    for (let k = 0; k < 300; k++) {
      const c = fair[Math.floor(Math.random() * fair.length)];
      const score = c.list.reduce((n, s) => n + (used.get(s.id) || 0), 0);
      if (score < bestScore) { best = c; bestScore = score; }
      if (score === 0) break;
    }
    for (const s of best.list) used.set(s.id, (used.get(s.id) || 0) + 1);
    result.push(best.list);
  }
  return result;
}

module.exports = { assign, fairRange: [fair[0].len, fair[fair.length - 1].len], fairCount: fair.length };
