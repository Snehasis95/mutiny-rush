// Player movement + collision. Shared by the server (validation) and the browser (prediction).
// physics.create(otherMap) gives the same movement rules for another map (the lobby room).
(function (factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./map'));
  } else {
    window.MR.Shared.physics = factory(window.MR.Shared.map);
  }
})(function factory(map) {
  const PLAYER_R = 26;
  const SPEED = 320; // world units per second

  const solids = map.walls.concat(map.props.filter(p => p.solid !== false));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Push a circle out of every solid rectangle it overlaps.
  // extra: temporary blockers (e.g. Kraken tentacles), same shape as walls.
  function resolve(x, y, extra) {
    const r = PLAYER_R;
    const list = extra && extra.length ? solids.concat(extra) : solids;
    for (let it = 0; it < 3; it++) {
      let hit = false;
      for (const s of list) {
        if (x + r <= s.x || x - r >= s.x + s.w || y + r <= s.y || y - r >= s.y + s.h) continue;
        const cx = clamp(x, s.x, s.x + s.w);
        const cy = clamp(y, s.y, s.y + s.h);
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          x += (dx / d) * (r - d);
          y += (dy / d) * (r - d);
        } else {
          // Center is inside the rect: push out along the shortest side.
          const l = x - s.x, rr = s.x + s.w - x, t = y - s.y, b = s.y + s.h - y;
          const m = Math.min(l, rr, t, b);
          if (m === l) x = s.x - r;
          else if (m === rr) x = s.x + s.w + r;
          else if (m === t) y = s.y - r;
          else y = s.y + s.h + r;
        }
      }
      if (!hit) break;
    }
    return { x: clamp(x, r, map.W - r), y: clamp(y, r, map.H - r) };
  }

  // Move from (x0,y0) toward (x1,y1) in small steps so nothing tunnels through walls.
  function sweep(x0, y0, x1, y1, extra) {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 10));
    let p = { x: x0, y: y0 };
    for (let i = 0; i < steps; i++) p = resolve(p.x + dx / steps, p.y + dy / steps, extra);
    return p;
  }

  function move(x, y, vx, vy, dt, speedMul = 1, extra) {
    const s = SPEED * speedMul * dt;
    return sweep(x, y, x + vx * s, y + vy * s, extra);
  }

  return { PLAYER_R, SPEED, resolve, sweep, move, create: factory };
});
