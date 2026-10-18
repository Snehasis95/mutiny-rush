// The six touch mini-games. Each start(ctx) builds itself inside ctx.stage and
// calls ctx.done() when finished. It returns a cleanup function.
// ctx = { stage, hint(text), done(), scramble } - scramble = harder version (🦜 Parrot)

MR.Minigames = (() => {
  const shuffle = a => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const rand = (a, b) => a + Math.random() * (b - a);

  // A canvas filling the given element, with a draw loop.
  function canvasIn(el, drawFn) {
    const c = document.createElement('canvas');
    c.className = 'mg-canvas';
    el.appendChild(c);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = el.clientWidth, h = el.clientHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    let raf = 0, last = performance.now(), alive = true;
    const loop = now => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      g.clearRect(0, 0, w, h);
      drawFn(g, dt, now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const pos = e => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    return { c, g, w, h, pos, stop: () => { alive = false; cancelAnimationFrame(raf); } };
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------------- 🪢 Tie the Ropes ----------------
  function ropes(ctx) {
    const COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#9b59b6', '#ff8c1a'];
    const N = ctx.scramble ? 6 : 4;
    const ids = [...Array(N).keys()];
    const left = shuffle(ids);
    const right = shuffle(ids);
    const tied = new Set();
    let drag = null;
    ctx.hint('Drag each rope to the knot of the same color');

    const cv = canvasIn(ctx.stage, g => {
      const { w, h } = cv;
      const R = Math.min(h * (N > 4 ? 0.05 : 0.07), 24);
      const LX = w * 0.14, RX = w * 0.86;
      const rowY = i => h * (0.14 + (0.72 / (N - 1)) * i);
      const leftPos = c => ({ x: LX, y: rowY(left.indexOf(c)) });
      const rightPos = c => ({ x: RX, y: rowY(right.indexOf(c)) });

      const rope = (a, b, color) => {
        const sag = Math.min(60, Math.abs(b.x - a.x) * 0.15);
        g.lineCap = 'round';
        for (const [lw, col] of [[14, 'rgba(0,0,0,.35)'], [10, color]]) {
          g.lineWidth = lw;
          g.strokeStyle = col;
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + sag, b.x, b.y);
          g.stroke();
        }
      };

      // Posts on each side
      g.fillStyle = '#5a3519';
      g.fillRect(LX - 46, h * 0.06, 22, h * 0.88);
      g.fillRect(RX + 24, h * 0.06, 22, h * 0.88);

      for (const c of tied) rope(leftPos(c), rightPos(c), COLORS[c]);
      if (drag) rope(leftPos(drag.c), drag, COLORS[drag.c]);

      for (const c of ids) {
        const l = leftPos(c), r = rightPos(c);
        g.fillStyle = COLORS[c];
        g.fillRect(l.x - 40, l.y - 7, 40, 14);
        g.beginPath(); g.arc(l.x, l.y, R * 0.7, 0, Math.PI * 2); g.fill();
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.4)'; g.stroke();

        g.fillStyle = tied.has(c) ? COLORS[c] : '#2b1a0c';
        g.beginPath(); g.arc(r.x, r.y, R, 0, Math.PI * 2); g.fill();
        g.lineWidth = 6; g.strokeStyle = COLORS[c]; g.stroke();
      }
      cv.hit = { LX, RX, rowY, R };
    });

    const near = (p, x, y, r) => Math.hypot(p.x - x, p.y - y) < r;
    cv.c.addEventListener('pointerdown', e => {
      if (!cv.hit) return;
      const p = cv.pos(e);
      const { LX, rowY, R } = cv.hit;
      for (const c of ids) {
        if (!tied.has(c) && near(p, LX, rowY(left.indexOf(c)), R * 2.2)) {
          drag = { c, x: p.x, y: p.y };
          cv.c.setPointerCapture(e.pointerId);
          MR.Sfx.click();
          return;
        }
      }
    });
    cv.c.addEventListener('pointermove', e => {
      if (!drag) return;
      Object.assign(drag, cv.pos(e));
    });
    const drop = e => {
      if (!drag) return;
      const p = cv.pos(e);
      const { RX, rowY, R } = cv.hit;
      const target = right.find(c => near(p, RX, rowY(right.indexOf(c)), R * 2.4));
      if (target === drag.c) {
        tied.add(drag.c);
        MR.Sfx.good();
        if (tied.size === N) setTimeout(ctx.done, 350);
      } else if (target != null) {
        MR.Sfx.bad();
        ctx.hint('Wrong knot! Match the colors.');
      }
      drag = null;
    };
    cv.c.addEventListener('pointerup', drop);
    cv.c.addEventListener('pointercancel', () => (drag = null));
    return cv.stop;
  }

  // ---------------- 🔐 Crack the Chest ----------------
  function chest(ctx) {
    const code = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join('');
    let typed = '';
    let showing = false;
    let timer = 0;

    const wrap = el('div', 'chest');
    const display = el('div', 'chest-display');
    const pad = el('div', 'keypad');
    wrap.append(display, pad);
    ctx.stage.appendChild(wrap);

    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];
    const buttons = keys.map(k => {
      const b = el('button', 'key' + (k === 'OK' ? ' key-ok' : ''), k);
      b.addEventListener('click', () => press(k));
      pad.appendChild(b);
      return b;
    });

    function render() {
      if (showing) display.textContent = code.split('').join(' ');
      else display.textContent = (typed + '____').slice(0, 4).split('').join(' ');
      display.classList.toggle('show', showing);
      buttons.forEach(b => (b.disabled = showing));
    }

    function reveal(ms) {
      showing = true;
      typed = '';
      ctx.hint('Memorize the code!');
      render();
      timer = setTimeout(() => {
        showing = false;
        ctx.hint('Enter the code');
        render();
      }, ms);
    }

    function press(k) {
      if (showing) return;
      MR.Sfx.click();
      if (k === '⌫') typed = typed.slice(0, -1);
      else if (k === 'OK') check();
      else if (typed.length < 4) typed += k;
      render();
      if (typed.length === 4 && k !== 'OK') check();
    }

    function check() {
      if (typed.length < 4) return;
      if (typed === code) {
        MR.Sfx.good();
        display.classList.add('good');
        setTimeout(ctx.done, 300);
      } else {
        MR.Sfx.bad();
        MR.vibrate(80);
        wrap.classList.remove('shake');
        void wrap.offsetWidth;
        wrap.classList.add('shake');
        ctx.hint('Wrong code! Look again…');
        timer = setTimeout(() => reveal(ctx.scramble ? 900 : 1500), 600);
      }
    }

    reveal(ctx.scramble ? 900 : 2000);
    return () => clearTimeout(timer);
  }

  // ---------------- 💣 Load the Cannon ----------------
  function cannon(ctx) {
    let fill = 0, holding = false, finished = false;
    const RATE = ctx.scramble ? 0.75 : 0.42;
    const zoneLo = rand(0.55, 0.75), zoneHi = zoneLo + (ctx.scramble ? 0.07 : 0.12);
    ctx.hint('Hold to pour gunpowder. Let go in the green zone!');

    const row = el('div', 'mg-row');
    const left = el('div', 'mg-fill');
    const btn = el('button', 'hold-btn', 'HOLD');
    row.append(left, btn);
    ctx.stage.appendChild(row);

    const cv = canvasIn(left, (g, dt) => {
      const { w, h } = cv;
      if (holding && !finished) {
        fill += RATE * dt;
        if (fill >= 1) spill();
      }
      const tw = Math.min(110, w * 0.4), th = h * 0.86;
      const x = (w - tw) / 2, y = (h - th) / 2;
      // Barrel tube
      g.fillStyle = '#2b1a0c';
      g.fillRect(x, y, tw, th);
      // Green zone
      g.fillStyle = 'rgba(63,163,77,.45)';
      g.fillRect(x, y + th * (1 - zoneHi), tw, th * (zoneHi - zoneLo));
      g.strokeStyle = '#3fa34d'; g.lineWidth = 3;
      g.strokeRect(x, y + th * (1 - zoneHi), tw, th * (zoneHi - zoneLo));
      // Powder
      g.fillStyle = '#555';
      g.fillRect(x + 6, y + th * (1 - fill), tw - 12, th * fill);
      g.fillStyle = '#777';
      if (fill > 0.03) for (let i = 0; i < 6; i++) g.fillRect(x + 10 + i * (tw - 20) / 6, y + th * (1 - fill) + 4, 4, 4);
      // Frame bands
      g.strokeStyle = '#8b5a2b'; g.lineWidth = 8;
      g.strokeRect(x, y, tw, th);
    });

    function spill() {
      holding = false;
      fill = 0;
      btn.classList.remove('down');
      MR.Sfx.bad();
      MR.vibrate(80);
      ctx.hint('Too much! It spilled. Try again.');
    }

    const down = e => {
      e.preventDefault();
      if (finished) return;
      holding = true;
      btn.classList.add('down');
      ctx.hint('Pouring…');
    };
    const up = () => {
      if (!holding || finished) return;
      holding = false;
      btn.classList.remove('down');
      if (fill >= zoneLo && fill <= zoneHi) {
        finished = true;
        MR.Sfx.good();
        ctx.hint('Loaded!');
        setTimeout(ctx.done, 300);
      } else if (fill > zoneHi) {
        spill();
      } else {
        ctx.hint('A bit more… hold again.');
      }
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
    return cv.stop;
  }

  // ---------------- 🗺️ Swipe the Map ----------------
  function mapSwipe(ctx) {
    const MIN_S = ctx.scramble ? 0.45 : 0.35, MAX_S = ctx.scramble ? 0.85 : 1.3;
    let pos = 0, dragging = false, startT = 0, locked = false;
    ctx.hint('Swipe the map across in one smooth move');

    const cv = canvasIn(ctx.stage, g => {
      const { w, h } = cv;
      const x0 = w * 0.1, x1 = w * 0.9, y = h * 0.5, mh = Math.min(h * 0.55, 180);
      const hx = x0 + (x1 - x0) * pos;
      // Track
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.fillRect(x0, y - mh / 2, x1 - x0, mh);
      g.setLineDash([10, 10]);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2;
      g.strokeRect(x0, y - mh / 2, x1 - x0, mh);
      g.setLineDash([]);
      // Unrolled parchment
      g.fillStyle = '#e8d5a3';
      g.fillRect(x0, y - mh / 2 + 6, hx - x0, mh - 12);
      g.save();
      g.beginPath(); g.rect(x0, y - mh / 2, hx - x0, mh); g.clip();
      g.strokeStyle = '#a0522d'; g.lineWidth = 3; g.setLineDash([8, 8]);
      g.beginPath(); g.moveTo(x0 + 20, y + mh * 0.25);
      g.bezierCurveTo(x0 + (x1 - x0) * 0.3, y - mh * 0.4, x0 + (x1 - x0) * 0.6, y + mh * 0.4, x1 - 40, y - mh * 0.1);
      g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#c0392b'; g.lineWidth = 5;
      const mx = x1 - 40, my = y - mh * 0.1;
      g.beginPath(); g.moveTo(mx - 10, my - 10); g.lineTo(mx + 10, my + 10);
      g.moveTo(mx + 10, my - 10); g.lineTo(mx - 10, my + 10); g.stroke();
      g.restore();
      // Roll (the handle)
      g.fillStyle = '#c9a76a';
      g.fillRect(hx - 16, y - mh / 2 - 8, 32, mh + 16);
      g.fillStyle = '#8b5a2b';
      g.fillRect(hx - 20, y - mh / 2 - 14, 40, 10);
      g.fillRect(hx - 20, y + mh / 2 + 4, 40, 10);
      if (pos === 0 && !dragging) {
        g.fillStyle = 'rgba(255,255,255,.8)';
        g.font = '600 18px Fredoka, sans-serif';
        g.textAlign = 'center';
        g.fillText('→ swipe →', (x0 + x1) / 2, y + 6);
      }
      cv.geo = { x0, x1, y, mh };
    });

    const reset = msg => {
      MR.Sfx.bad();
      ctx.hint(msg);
      locked = true;
      dragging = false;
      setTimeout(() => { pos = 0; locked = false; }, 500);
    };

    cv.c.addEventListener('pointerdown', e => {
      if (locked || !cv.geo) return;
      const p = cv.pos(e);
      const { x0, x1 } = cv.geo;
      const hx = x0 + (x1 - x0) * pos;
      if (Math.abs(p.x - hx) < 70) {
        dragging = true;
        startT = performance.now();
        cv.c.setPointerCapture(e.pointerId);
      }
    });
    cv.c.addEventListener('pointermove', e => {
      if (!dragging) return;
      const { x0, x1 } = cv.geo;
      pos = Math.max(pos, Math.min(1, (cv.pos(e).x - x0) / (x1 - x0)));
      if (pos >= 0.97) {
        dragging = false;
        const s = (performance.now() - startT) / 1000;
        if (s < MIN_S) reset('Too fast! Steady hands, matey.');
        else if (s > MAX_S) reset('Too slow! Try a quicker swipe.');
        else {
          pos = 1;
          locked = true;
          MR.Sfx.good();
          ctx.hint('Map unrolled!');
          setTimeout(ctx.done, 300);
        }
      }
    });
    const release = () => {
      if (dragging) reset('Swipe all the way across!');
    };
    cv.c.addEventListener('pointerup', release);
    cv.c.addEventListener('pointercancel', release);
    return cv.stop;
  }

  // ---------------- 🔔 Ring the Bells ----------------
  function bells(ctx) {
    const COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71'];
    const NOTES = [523, 659, 784, 988];
    const pattern = Array.from({ length: ctx.scramble ? 6 : 4 }, () => Math.floor(Math.random() * 4));
    let input = [], playing = false;
    const timers = [];

    const row = el('div', 'bells');
    const pads = COLORS.map((c, i) => {
      const b = el('button', 'bell', '🔔');
      b.style.background = c;
      b.addEventListener('pointerdown', e => { e.preventDefault(); tap(i); });
      row.appendChild(b);
      return b;
    });
    ctx.stage.appendChild(row);

    function flash(i, ms = 380) {
      pads[i].classList.add('lit');
      MR.Sfx.tone(NOTES[i], 0.3, 'triangle', 0.2);
      timers.push(setTimeout(() => pads[i].classList.remove('lit'), ms));
    }

    function play() {
      playing = true;
      input = [];
      ctx.hint('Watch the bells…');
      pads.forEach(p => (p.disabled = true));
      pattern.forEach((b, k) => timers.push(setTimeout(() => flash(b), 600 + k * 600)));
      timers.push(setTimeout(() => {
        playing = false;
        pads.forEach(p => (p.disabled = false));
        ctx.hint('Your turn! Ring them in the same order.');
      }, 600 + pattern.length * 600));
    }

    function tap(i) {
      if (playing) return;
      flash(i, 200);
      input.push(i);
      const k = input.length - 1;
      if (input[k] !== pattern[k]) {
        MR.Sfx.bad();
        MR.vibrate(80);
        ctx.hint('Wrong bell! Watch again…');
        playing = true;
        timers.push(setTimeout(play, 700));
      } else if (input.length === pattern.length) {
        playing = true;
        ctx.hint('Perfect!');
        timers.push(setTimeout(() => { MR.Sfx.good(); ctx.done(); }, 400));
      }
    }

    play();
    return () => timers.forEach(clearTimeout);
  }

  // ---------------- 🧭 Fix the Compass ----------------
  function compass(ctx) {
    const NEED = 3, ZONE = ctx.scramble ? 0.17 : 0.24;
    let angle = rand(0.8, 5.4), speed = ctx.scramble ? 3.6 : 2.4, dir = Math.random() < 0.5 ? 1 : -1;
    let hits = 0, cooldown = 0, flashT = 0, flashGood = false, finished = false;
    ctx.hint('Tap when the needle points north! (3 times)');

    const cv = canvasIn(ctx.stage, (g, dt) => {
      const { w, h } = cv;
      if (!finished) angle = (angle + speed * dir * dt + Math.PI * 2) % (Math.PI * 2);
      cooldown -= dt;
      flashT -= dt;
      const cx = w / 2, cy = h * 0.56, r = Math.min(w, h) * 0.36;

      // Dial
      g.fillStyle = '#8b5a2b';
      g.beginPath(); g.arc(cx, cy, r + 12, 0, Math.PI * 2); g.fill();
      g.fillStyle = flashT > 0 ? (flashGood ? '#c8f0c8' : '#f4c4c0') : '#f3e2bf';
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      // North zone
      g.fillStyle = 'rgba(63,163,77,.45)';
      g.beginPath(); g.moveTo(cx, cy);
      g.arc(cx, cy, r, -Math.PI / 2 - ZONE, -Math.PI / 2 + ZONE); g.closePath(); g.fill();
      // Letters
      g.fillStyle = '#3b2412';
      g.font = `700 ${Math.round(r * 0.2)}px Fredoka, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('N', cx, cy - r * 0.78);
      g.fillText('S', cx, cy + r * 0.78);
      g.fillText('E', cx + r * 0.78, cy);
      g.fillText('W', cx - r * 0.78, cy);
      // Needle (angle 0 = north)
      g.save();
      g.translate(cx, cy);
      g.rotate(angle);
      g.fillStyle = '#c0392b';
      g.beginPath(); g.moveTo(0, -r * 0.68); g.lineTo(10, 0); g.lineTo(-10, 0); g.closePath(); g.fill();
      g.fillStyle = '#34495e';
      g.beginPath(); g.moveTo(0, r * 0.5); g.lineTo(10, 0); g.lineTo(-10, 0); g.closePath(); g.fill();
      g.restore();
      g.fillStyle = '#d4a017';
      g.beginPath(); g.arc(cx, cy, 8, 0, Math.PI * 2); g.fill();
      // Hit dots
      for (let i = 0; i < NEED; i++) {
        g.fillStyle = i < hits ? '#3fa34d' : 'rgba(255,255,255,.35)';
        g.beginPath(); g.arc(w / 2 + (i - 1) * 30, 16, 9, 0, Math.PI * 2); g.fill();
      }
    });

    cv.c.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (finished || cooldown > 0) return;
      const off = Math.min(angle, Math.PI * 2 - angle); // distance from north
      cooldown = 0.35;
      flashT = 0.25;
      if (off <= ZONE) {
        hits++;
        flashGood = true;
        MR.Sfx.good();
        if (hits >= NEED) {
          finished = true;
          ctx.hint('Compass fixed!');
          setTimeout(ctx.done, 350);
          return;
        }
        speed += 0.6;
        dir = Math.random() < 0.5 ? 1 : -1;
        angle = rand(1.2, 5.1);
        ctx.hint(`Nice! ${NEED - hits} more.`);
      } else {
        flashGood = false;
        MR.Sfx.bad();
        ctx.hint('Missed! Wait for north.');
      }
    });
    return cv.stop;
  }

  return { ropes, chest, cannon, map: mapSwipe, bells, compass };
})();
