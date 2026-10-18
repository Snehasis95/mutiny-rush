// Input: floating virtual joystick (touch) + WASD/arrow keys (PC testing).
window.MR = window.MR || {};
MR.Input = (() => {
  const RADIUS = 60;     // joystick drag radius in CSS px
  const DEADZONE = 0.15;
  const keys = new Set();
  const joy = { active: false, id: null, bx: 0, by: 0, kx: 0, ky: 0 };
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.key.toLowerCase());
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  function attach(el, onFirstTouch) {
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      if (onFirstTouch) onFirstTouch();
      for (const t of e.changedTouches) {
        // Joystick appears wherever the left thumb lands.
        if (!joy.active && t.clientX < window.innerWidth / 2) {
          Object.assign(joy, { active: true, id: t.identifier, bx: t.clientX, by: t.clientY, kx: 0, ky: 0 });
        }
      }
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== joy.id) continue;
        let dx = t.clientX - joy.bx, dy = t.clientY - joy.by;
        const len = Math.hypot(dx, dy);
        if (len > RADIUS) { dx *= RADIUS / len; dy *= RADIUS / len; }
        joy.kx = dx;
        joy.ky = dy;
      }
    }, { passive: false });

    const end = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === joy.id) Object.assign(joy, { active: false, id: null, kx: 0, ky: 0 });
      }
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  // Returns a movement vector with length 0..1.
  function vector() {
    let x = 0, y = 0;
    if (joy.active) {
      x = joy.kx / RADIUS;
      y = joy.ky / RADIUS;
      const m = Math.hypot(x, y);
      if (m < DEADZONE) return { x: 0, y: 0 };
      // ~70% stick deflection already gives full speed.
      const f = Math.min(1, (m - DEADZONE) / 0.55) / m;
      return { x: x * f, y: y * f };
    }
    if (keys.has('w') || keys.has('arrowup')) y -= 1;
    if (keys.has('s') || keys.has('arrowdown')) y += 1;
    if (keys.has('a') || keys.has('arrowleft')) x -= 1;
    if (keys.has('d') || keys.has('arrowright')) x += 1;
    const m = Math.hypot(x, y);
    return m ? { x: x / m, y: y / m } : { x: 0, y: 0 };
  }

  function reset() {
    keys.clear();
    Object.assign(joy, { active: false, id: null, kx: 0, ky: 0 });
  }

  return { attach, vector, reset, joy, RADIUS, isTouch };
})();
