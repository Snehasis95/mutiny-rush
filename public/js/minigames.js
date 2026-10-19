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

  function roundRectPath(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

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

  // ---------------- 🍲 Cook the Grog ----------------
  // Drag (or tap) ingredients into the pot in the order on the recipe card.
  function grog(ctx) {
    const ING = [
      { e: '🍋', n: 'Lime' }, { e: '🍯', n: 'Honey' }, { e: '🌶️', n: 'Pepper' },
      { e: '🥥', n: 'Coconut' }, { e: '🍌', n: 'Banana' }, { e: '🧂', n: 'Salt' },
    ];
    const recipe = shuffle(ING).slice(0, 4);
    let step = 0, finished = false, hideTimer = 0;

    const wrap = el('div', 'grog');
    const card = el('div', 'grog-card');
    const pot = el('div', 'grog-pot');
    pot.innerHTML = '<div class="grog-steam">♨</div><div class="grog-bowl"></div>';
    const shelf = el('div', 'grog-shelf');
    wrap.append(card, pot, shelf);
    ctx.stage.appendChild(wrap);

    let recipeHidden = false;
    function renderCard() {
      card.replaceChildren(el('div', 'grog-card-title', 'Recipe'), ...recipe.map((r, i) => {
        const row = el('div', 'grog-line' + (i < step ? ' done' : ''));
        // Steps you haven't done yet turn into question marks while the recipe is hidden.
        row.textContent = recipeHidden && i >= step ? `${i + 1}. ❓ ? ? ?` : `${i + 1}. ${r.e} ${r.n}`;
        return row;
      }));
    }
    renderCard();

    // The recipe hides once you start cooking (scrambled: it only flashes briefly),
    // so you cook from memory. A mistake shows it again.
    const showRecipe = show => {
      recipeHidden = !show;
      card.classList.toggle('hidden-recipe', !show);
      renderCard();
    };
    function reveal(intro) {
      clearTimeout(hideTimer);
      showRecipe(true);
      if (ctx.scramble) {
        ctx.hint(intro || 'Memorize the recipe!');
        hideTimer = setTimeout(() => {
          showRecipe(false);
          ctx.hint('Add them in the same order');
        }, 1500);
      } else {
        ctx.hint(intro || 'Memorize the recipe. It hides once you start cooking!');
      }
    }
    reveal();

    function add(ing) {
      if (finished) return;
      if (ing === recipe[step]) {
        if (step === 0 && !ctx.scramble) {
          showRecipe(false);
          ctx.hint('From memory now. What comes next?');
        }
        step++;
        MR.Sfx.click();
        pot.classList.remove('bubble');
        void pot.offsetWidth;
        pot.classList.add('bubble');
        renderCard();
        if (step === recipe.length) {
          finished = true;
          MR.Sfx.good();
          ctx.hint('Grog is ready! Yo-ho!');
          setTimeout(ctx.done, 400);
        }
      } else {
        step = 0;
        MR.Sfx.bad();
        MR.vibrate(80);
        pot.classList.remove('splash');
        void pot.offsetWidth;
        pot.classList.add('splash');
        renderCard();
        reveal(`Yuck, not ${ing.n}! Here's the recipe again. Start over.`);
      }
    }

    // Each ingredient can be dragged onto the pot, or simply tapped.
    for (const ing of ING) {
      const b = el('button', 'grog-ing', ing.e);
      b.setAttribute('aria-label', ing.n);
      shelf.appendChild(b);
      let ghost = null, sx = 0, sy = 0;
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        sx = e.clientX; sy = e.clientY;
        ghost = el('div', 'grog-ghost', ing.e);
        document.body.appendChild(ghost);
        ghost.style.left = e.clientX + 'px';
        ghost.style.top = e.clientY + 'px';
      });
      b.addEventListener('pointermove', e => {
        if (!ghost) return;
        ghost.style.left = e.clientX + 'px';
        ghost.style.top = e.clientY + 'px';
      });
      const drop = e => {
        if (!ghost) return;
        ghost.remove();
        ghost = null;
        const moved = Math.hypot(e.clientX - sx, e.clientY - sy) > 12;
        const r = pot.getBoundingClientRect();
        const inPot = e.clientX > r.left - 20 && e.clientX < r.right + 20 && e.clientY > r.top - 20 && e.clientY < r.bottom + 20;
        if (!moved || inPot) add(ing); // a tap counts too
      };
      b.addEventListener('pointerup', drop);
      b.addEventListener('pointercancel', () => { if (ghost) { ghost.remove(); ghost = null; } });
    }

    return () => {
      clearTimeout(hideTimer);
      document.querySelectorAll('.grog-ghost').forEach(g => g.remove());
    };
  }

  // ---------------- 🧽 Swab the Deck ----------------
  // Mud stains sit on their own layer; your finger wipes them off along its path.
  // At 85% clean the last specks fade away by themselves.
  function swab(ctx) {
    const CELL = 12;
    const BRUSH = ctx.scramble ? 22 : 32;
    const GOAL = 0.85;
    let dirt = null, cells = null, total = 0, cleaned = 0;
    let finished = false, fade = 1, rubbing = null, last = null;
    const foam = [], sparkles = [];
    ctx.hint('Scrub the mud off the deck with your finger!');

    function makeDirt(w, h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const d = c.getContext('2d');
      const stains = ctx.scramble ? 7 : 4;
      for (let i = 0; i < stains; i++) {
        const cx = rand(w * 0.12, w * 0.88), cy = rand(h * 0.25, h * 0.85), r = rand(42, 70);
        // An irregular splotch built from overlapping soft blobs
        for (let k = 0; k < 14; k++) {
          const a = rand(0, Math.PI * 2), dd = rand(0, r * 0.6), rr = rand(r * 0.35, r * 0.7);
          const x = cx + Math.cos(a) * dd, y = cy + Math.sin(a) * dd * 0.8;
          const shade = Math.floor(rand(70, 95));
          const grad = d.createRadialGradient(x, y, rr * 0.2, x, y, rr);
          grad.addColorStop(0, `rgba(${shade + 10},${shade - 12},${shade - 45},0.95)`);
          grad.addColorStop(0.7, `rgba(${shade},${shade - 20},${shade - 50},0.85)`);
          grad.addColorStop(1, `rgba(${shade},${shade - 20},${shade - 50},0)`);
          d.fillStyle = grad;
          d.beginPath(); d.arc(x, y, rr, 0, Math.PI * 2); d.fill();
        }
        // Splatter around the edge
        d.fillStyle = 'rgba(70,48,20,.85)';
        for (let k = 0; k < 8; k++) {
          const a = rand(0, Math.PI * 2), dd = rand(r * 0.8, r * 1.25);
          d.beginPath(); d.arc(cx + Math.cos(a) * dd, cy + Math.sin(a) * dd, rand(3, 7), 0, Math.PI * 2); d.fill();
        }
      }
      return c;
    }

    // Which grid cells start out muddy (used to measure progress)
    function measure(w, h) {
      const data = dirt.getContext('2d').getImageData(0, 0, w, h).data;
      cells = [];
      for (let y = CELL / 2; y < h; y += CELL) {
        const row = [];
        for (let x = CELL / 2; x < w; x += CELL) {
          const muddy = data[((Math.floor(y) * w) + Math.floor(x)) * 4 + 3] > 90;
          row.push(muddy);
          if (muddy) total++;
        }
        cells.push(row);
      }
    }

    const cv = canvasIn(ctx.stage, (g, dt) => {
      const { w, h } = cv;
      if (!dirt) {
        dirt = makeDirt(w, h);
        measure(w, h);
      }
      // Deck planks
      g.fillStyle = '#c39462';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(60,35,15,.3)';
      g.lineWidth = 2;
      for (let y = 0; y < h; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let y = 0, i = 0; y < h; y += 30, i++) {
        for (let x = (i * 97) % 180; x < w; x += 180) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 30); g.stroke(); }
      }
      // Mud (fades out once you're done)
      if (finished) fade = Math.max(0, fade - dt * 2.5);
      g.globalAlpha = fade;
      g.drawImage(dirt, 0, 0, w, h);
      g.globalAlpha = 1;
      // Soap bubbles
      for (let i = foam.length - 1; i >= 0; i--) {
        const f = foam[i];
        f.life -= dt;
        f.y -= dt * 8;
        if (f.life <= 0) { foam.splice(i, 1); continue; }
        g.strokeStyle = `rgba(255,255,255,${f.life})`;
        g.fillStyle = `rgba(255,255,255,${f.life * 0.35})`;
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(f.x, f.y, f.r, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      // Sparkles when it's clean
      g.font = '22px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const sp = sparkles[i];
        sp.life -= dt;
        if (sp.life <= 0) { sparkles.splice(i, 1); continue; }
        g.globalAlpha = Math.min(1, sp.life * 2);
        g.fillText('✨', sp.x, sp.y);
        g.globalAlpha = 1;
      }
      if (rubbing && !finished) {
        g.font = '38px sans-serif';
        g.fillText('🧽', rubbing.x, rubbing.y);
      }
      // Progress bar with a label
      const pct = total ? Math.min(1, cleaned / total / GOAL) : 0;
      const bw = Math.min(320, w * 0.5), bx = (w - bw) / 2;
      g.fillStyle = 'rgba(0,0,0,.45)';
      roundRectPath(g, bx, 8, bw, 24, 12); g.fill();
      g.fillStyle = pct >= 1 ? '#3fa34d' : '#ffd23c';
      if (pct > 0) { roundRectPath(g, bx, 8, Math.max(24, bw * pct), 24, 12); g.fill(); }
      g.fillStyle = '#fff';
      g.font = '700 14px Fredoka, sans-serif';
      g.fillText(pct >= 1 ? '✨ Spotless!' : `🧽 Cleaning… ${Math.floor(pct * 100)}%`, w / 2, 21);
    });

    function scrub(p) {
      if (!dirt || finished) return;
      rubbing = p;
      const d = dirt.getContext('2d');
      // Wipe the mud along the finger's path
      d.globalCompositeOperation = 'destination-out';
      d.lineCap = 'round';
      d.lineWidth = BRUSH * 2;
      d.beginPath();
      d.moveTo((last || p).x, (last || p).y);
      d.lineTo(p.x + 0.01, p.y);
      d.stroke();
      d.globalCompositeOperation = 'source-over';
      // Clear the matching grid cells along the same path
      const from = last || p;
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / (CELL / 2)));
      let got = 0;
      for (let k = 0; k <= steps; k++) {
        const x = from.x + ((p.x - from.x) * k) / steps, y = from.y + ((p.y - from.y) * k) / steps;
        const r0 = Math.max(0, Math.floor((y - BRUSH) / CELL)), r1 = Math.min(cells.length - 1, Math.floor((y + BRUSH) / CELL));
        const c0 = Math.max(0, Math.floor((x - BRUSH) / CELL)), c1 = Math.min(cells[0].length - 1, Math.floor((x + BRUSH) / CELL));
        for (let ry = r0; ry <= r1; ry++) {
          for (let rx = c0; rx <= c1; rx++) {
            if (cells[ry][rx] && Math.hypot(rx * CELL + CELL / 2 - x, ry * CELL + CELL / 2 - y) < BRUSH) {
              cells[ry][rx] = false;
              got++;
            }
          }
        }
      }
      last = p;
      cleaned += got;
      if (got || Math.random() < 0.3) foam.push({ x: p.x + rand(-16, 16), y: p.y + rand(-16, 16), r: rand(4, 10), life: 0.9 });
      if (got && Math.random() < 0.2) MR.Sfx.step();
      if (cleaned / total >= GOAL) {
        finished = true;
        rubbing = null;
        for (let i = 0; i < 10; i++) sparkles.push({ x: rand(cv.w * 0.1, cv.w * 0.9), y: rand(cv.h * 0.2, cv.h * 0.9), life: rand(0.6, 1.1) });
        MR.Sfx.good();
        ctx.hint('Spotless! The bosun would be proud.');
        setTimeout(ctx.done, 650);
      }
    }

    cv.c.addEventListener('pointerdown', e => { cv.c.setPointerCapture(e.pointerId); last = null; scrub(cv.pos(e)); });
    cv.c.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') scrub(cv.pos(e)); });
    const stop = () => { rubbing = null; last = null; };
    cv.c.addEventListener('pointerup', stop);
    cv.c.addEventListener('pointercancel', stop);
    return cv.stop;
  }

  // ---------------- ⚓ Raise the Anchor ----------------
  // Push the capstan round by drawing clockwise circles. It has a little momentum,
  // clicks like a ratchet, coils the rope and hauls the anchor up out of the sea.
  function anchorTask(ctx) {
    const TURNS = ctx.scramble ? 4 : 3;
    const GOAL = TURNS * Math.PI * 2;
    const CLICK = Math.PI / 4; // ratchet click every eighth of a turn
    let progress = 0, vel = 0, lastAngle = null, lastT = 0, dragging = false;
    let finished = false, doneT = 0, lastClick = 0;
    const trail = [], drips = [];
    ctx.hint(ctx.scramble
      ? `Haul fast! The chain slips back if you stop. ${TURNS} turns.`
      : `Push the capstan round clockwise: ${TURNS} full turns`);

    function addProgress(d) {
      if (finished || d <= 0) return;
      progress = Math.min(GOAL, progress + d);
      if (Math.floor(progress / CLICK) > lastClick) {
        lastClick = Math.floor(progress / CLICK);
        MR.Sfx.tone(lastClick % 2 ? 900 : 700, 0.03, 'square', 0.05);
        MR.vibrate(6);
      }
      if (progress >= GOAL) {
        finished = true;
        doneT = 0;
        vel = 0;
        MR.Sfx.tone(110, 0.25, 'sine', 0.25, 60); // clunk
        MR.vibrate([30, 30, 60]);
        setTimeout(() => MR.Sfx.good(), 150);
        ctx.hint('Anchor aweigh!');
        setTimeout(ctx.done, 700);
      }
    }

    function drawAnchor(g, x, y, k) {
      g.save();
      g.translate(x, y);
      g.scale(k, k);
      g.strokeStyle = '#2b2f33';
      g.fillStyle = '#4b535a';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath(); g.arc(0, -34, 7, 0, Math.PI * 2); g.stroke();      // ring
      g.fillRect(-4, -28, 8, 52); g.strokeRect(-4, -28, 8, 52);         // shank
      g.fillRect(-20, -20, 40, 6); g.strokeRect(-20, -20, 40, 6);       // stock
      g.beginPath();                                                     // arms
      g.moveTo(-26, 6); g.quadraticCurveTo(-22, 28, 0, 28); g.quadraticCurveTo(22, 28, 26, 6);
      g.lineWidth = 8; g.strokeStyle = '#4b535a'; g.stroke();
      g.lineWidth = 2; g.strokeStyle = '#2b2f33'; g.stroke();
      g.fillStyle = '#4b535a';                                           // flukes
      for (const sx of [-1, 1]) {
        g.beginPath(); g.moveTo(sx * 26, 6); g.lineTo(sx * 34, 0); g.lineTo(sx * 24, 16); g.closePath(); g.fill(); g.stroke();
      }
      g.restore();
    }

    const cv = canvasIn(ctx.stage, (g, dt) => {
      const { w, h } = cv;
      const now = performance.now() / 1000;

      // Momentum after you let go, and the scrambled slip-back
      if (!dragging && !finished) {
        if (vel > 0) {
          addProgress(vel * dt);
          vel = Math.max(0, vel - dt * 14); // friction: a flick adds at most ~1/3 turn
        } else if (ctx.scramble && progress > 0) {
          progress = Math.max(0, progress - dt * 1.8);
          lastClick = Math.floor(progress / CLICK);
          if (Math.random() < 0.15) MR.Sfx.tone(rand(500, 700), 0.02, 'square', 0.03); // chain rattle
        }
      }
      if (finished) doneT += dt;

      // Deck
      g.fillStyle = '#b98a55';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(60,35,15,.28)';
      g.lineWidth = 2;
      for (let y = 0; y < h; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(w * 0.68, y); g.stroke(); }

      const cx = w * 0.36, cy = h * 0.53, r = Math.min(h * 0.27, w * 0.17);
      cv.center = { x: cx, y: cy, r };

      // Guide: a glowing arc chasing round clockwise while idle
      if (!dragging && !finished) {
        const ga = (now * 2.2) % (Math.PI * 2);
        g.strokeStyle = 'rgba(255,230,140,.55)';
        g.lineWidth = 10;
        g.lineCap = 'round';
        g.beginPath(); g.arc(cx, cy, r * 1.62, ga, ga + 1.1); g.stroke();
        const ex = cx + Math.cos(ga + 1.1) * r * 1.62, ey = cy + Math.sin(ga + 1.1) * r * 1.62;
        g.fillStyle = 'rgba(255,230,140,.8)';
        g.beginPath(); g.arc(ex, ey, 8, 0, Math.PI * 2); g.fill();
      }

      // Finger trail
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].life -= dt * 2.5;
        if (trail[i].life <= 0) trail.splice(i, 1);
      }
      for (const t of trail) {
        g.fillStyle = `rgba(255,240,170,${t.life * 0.45})`;
        g.beginPath(); g.arc(t.x, t.y, 14 * t.life, 0, Math.PI * 2); g.fill();
      }

      // Capstan: shadow, push-bars, drum, coiled rope, iron bands, cap
      g.fillStyle = 'rgba(0,0,0,.22)';
      g.beginPath(); g.arc(cx + 6, cy + 10, r * 0.7, 0, Math.PI * 2); g.fill();
      g.save();
      g.translate(cx, cy);
      g.rotate(progress);
      g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const x1 = Math.cos(ang) * r * 0.55, y1 = Math.sin(ang) * r * 0.55;
        const x2 = Math.cos(ang) * r * 1.45, y2 = Math.sin(ang) * r * 1.45;
        for (const [col, lw] of [['#3d2210', 15], ['#c9965a', 9]]) {
          g.strokeStyle = col; g.lineWidth = lw;
          g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        }
        g.fillStyle = '#8b5a2b';
        g.strokeStyle = '#3d2210';
        g.lineWidth = 3;
        g.beginPath(); g.arc(x2, y2, 9, 0, Math.PI * 2); g.fill(); g.stroke(); // handle knob
      }
      // Drum
      g.fillStyle = '#7a4b26';
      g.beginPath(); g.arc(0, 0, r * 0.72, 0, Math.PI * 2); g.fill();
      // Rope coils grow as you wind
      const coils = Math.min(7, 1 + Math.floor((progress / GOAL) * 7));
      for (let i = 0; i < coils; i++) {
        g.strokeStyle = i % 2 ? '#c9a76a' : '#b8925a';
        g.lineWidth = 4;
        g.beginPath(); g.arc(0, 0, r * (0.6 - i * 0.035), 0, Math.PI * 2); g.stroke();
      }
      // Iron band + rivets
      g.strokeStyle = '#3a3f44';
      g.lineWidth = 5;
      g.beginPath(); g.arc(0, 0, r * 0.72, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#5c646b';
      g.beginPath(); g.arc(0, 0, r * 0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9aa3ab';
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + Math.PI / 6;
        g.beginPath(); g.arc(Math.cos(ang) * r * 0.2, Math.sin(ang) * r * 0.2, 3, 0, Math.PI * 2); g.fill();
      }
      g.restore();

      // Ship's side cut-away: pulley, chain, sea, anchor
      const px = w * 0.73, pw = w * 0.25;
      g.fillStyle = '#6b4423';
      g.fillRect(px, 0, pw, h);
      const ax = px + pw / 2, top = h * 0.14, seaY = h * 0.68, bottom = h * 0.9;
      const pct = progress / GOAL;
      const ay = bottom - (bottom - top - 40) * pct + (finished ? Math.sin(doneT * 25) * 3 * Math.max(0, 1 - doneT * 3) : 0);
      // Sea
      g.fillStyle = '#1f6f8b';
      g.beginPath();
      g.moveTo(px, h);
      for (let x = px; x <= px + pw; x += 8) g.lineTo(x, seaY + Math.sin(x * 0.08 + now * 3) * 4);
      g.lineTo(px + pw, h);
      g.closePath();
      g.fill();
      // Pulley
      g.fillStyle = '#3a3f44';
      g.beginPath(); g.arc(ax, top - 10, 14, 0, Math.PI * 2); g.fill();
      g.save();
      g.translate(ax, top - 10);
      g.rotate(-progress * 2);
      g.strokeStyle = '#9aa3ab';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(-10, 0); g.lineTo(10, 0); g.moveTo(0, -10); g.lineTo(0, 10); g.stroke();
      g.restore();
      // Chain links scroll upward as you haul
      const linkH = 14, phase = (progress * 18) % (linkH * 2);
      g.save();
      g.beginPath(); g.rect(px, top, pw, ay - 34 - top); g.clip();
      for (let y = top - linkH * 2 + (linkH * 2 - phase); y < ay; y += linkH) {
        const vertical = Math.round((y - top) / linkH) % 2 === 0;
        g.strokeStyle = '#8f989f';
        g.lineWidth = 3;
        g.beginPath();
        if (vertical) g.ellipse(ax, y, 4, 8, 0, 0, Math.PI * 2);
        else g.ellipse(ax, y, 7, 5, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
      drawAnchor(g, ax, ay, Math.min(1.2, pw / 90));
      // Water dripping off the anchor once it's out of the sea
      if (ay < seaY - 10 && Math.random() < 0.3) drips.push({ x: ax + rand(-22, 22), y: ay + 20, vy: 0 });
      for (let i = drips.length - 1; i >= 0; i--) {
        const d = drips[i];
        d.vy += 600 * dt; d.y += d.vy * dt;
        if (d.y > seaY) { drips.splice(i, 1); continue; }
        g.fillStyle = 'rgba(160,215,255,.9)';
        g.beginPath(); g.arc(d.x, d.y, 2.5, 0, Math.PI * 2); g.fill();
      }

      // Turn counter pips
      const done = Math.min(TURNS, Math.floor(progress / (Math.PI * 2) + 1e-6));
      for (let i = 0; i < TURNS; i++) {
        const x = cx + (i - (TURNS - 1) / 2) * 26, y = h - 16;
        g.fillStyle = i < done ? '#3fa34d' : 'rgba(0,0,0,.3)';
        g.strokeStyle = 'rgba(0,0,0,.4)';
        g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    });

    const angleAt = p => Math.atan2(p.y - cv.center.y, p.x - cv.center.x);
    cv.c.addEventListener('pointerdown', e => {
      if (!cv.center || finished) return;
      cv.c.setPointerCapture(e.pointerId);
      const p = cv.pos(e);
      lastAngle = angleAt(p);
      lastT = performance.now();
      dragging = true;
      vel = 0;
      trail.push({ x: p.x, y: p.y, life: 1 });
    });
    cv.c.addEventListener('pointermove', e => {
      if (!dragging || finished) return;
      const p = cv.pos(e);
      trail.push({ x: p.x, y: p.y, life: 1 });
      if (trail.length > 40) trail.shift();
      if (Math.hypot(p.x - cv.center.x, p.y - cv.center.y) < cv.center.r * 0.3) return; // too close to the middle
      const ang = angleAt(p);
      let d = ang - lastAngle;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      lastAngle = ang;
      const t = performance.now();
      const dts = Math.max(0.008, (t - lastT) / 1000);
      lastT = t;
      if (d > 0) {
        addProgress(d);
        vel = Math.min(8, vel * 0.7 + (d / dts) * 0.3); // smoothed spin speed, kept for momentum
      } else {
        vel = 0;
      }
    });
    const release = () => {
      dragging = false;
      lastAngle = null;
      if (performance.now() - lastT > 120) vel = 0; // finger had stopped before lifting
    };
    cv.c.addEventListener('pointerup', release);
    cv.c.addEventListener('pointercancel', release);
    return cv.stop;
  }

  // ---------------- 🔨 Patch the Hull ----------------
  // Water sprays from leaks. Drag a plank over each leak, then tap the glowing nails to hammer it in.
  function patch(ctx) {
    const LEAKS = ctx.scramble ? 4 : 3;
    let leaks = null, planks = null, drag = null, finished = false;
    let water = 0.06, shake = 0, hammer = null, PW = 100, PH = 42;
    const drops = [];
    ctx.hint('Drag a plank over each leak!');

    const cv = canvasIn(ctx.stage, (g, dt) => {
      const { w, h } = cv;
      const hullW = w * 0.72;
      if (!leaks) {
        PW = Math.min(120, hullW * 0.26);
        PH = Math.round(PW * 0.42);
        // Spread the leaks over a 3 x 2 grid of spots on the hull
        const spots = [];
        for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.3, 0.6]) spots.push({ x: hullW * fx, y: h * fy });
        leaks = shuffle(spots).slice(0, LEAKS).map(s => ({ x: s.x + rand(-15, 15), y: s.y + rand(-10, 10), patched: false }));
        planks = Array.from({ length: LEAKS }, (_, i) => {
          const home = { x: w * 0.86, y: h * ((i + 1) / (LEAKS + 1)) };
          return { x: home.x, y: home.y, home, leak: null, nails: [] };
        });
      }

      shake = Math.max(0, shake - dt);
      const sx = shake > 0 ? rand(-3, 3) : 0, sy = shake > 0 ? rand(-3, 3) : 0;
      g.save();
      g.translate(sx, sy);

      // Hull wall
      g.fillStyle = '#5e3a1c';
      g.fillRect(0, 0, hullW, h);
      g.strokeStyle = 'rgba(25,12,4,.55)';
      g.lineWidth = 3;
      for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(hullW, y); g.stroke(); }
      g.fillStyle = '#4a2c14';
      for (const fx of [0.33, 0.66]) g.fillRect(hullW * fx - 8, 0, 16, h); // ribs

      // Water rising in the hold until you're done, then draining
      water = finished ? Math.max(0, water - dt * 0.4) : Math.min(0.32, water + dt * 0.012);
      const wy = h * (1 - water);
      g.fillStyle = 'rgba(40,120,170,.7)';
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= hullW; x += 12) g.lineTo(x, wy + Math.sin(x * 0.05 + performance.now() / 300) * 4);
      g.lineTo(hullW, h);
      g.closePath();
      g.fill();

      // Leaks: dark crack + spraying water
      for (const lk of leaks) {
        if (lk.patched) continue;
        g.fillStyle = '#120a04';
        g.beginPath(); g.ellipse(lk.x, lk.y, 13, 9, 0.4, 0, Math.PI * 2); g.fill();
        for (let k = 0; k < 2; k++) {
          drops.push({ x: lk.x, y: lk.y, vx: rand(-80, 80), vy: rand(-140, -40), life: 1 });
        }
      }
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.vy += 420 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt;
        if (d.life <= 0 || d.y > wy) { drops.splice(i, 1); continue; }
        g.fillStyle = 'rgba(150,210,255,.85)';
        g.beginPath(); g.arc(d.x, d.y, 3, 0, Math.PI * 2); g.fill();
      }

      // Plank tray
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.fillRect(w * 0.74, 0, w * 0.26, h);

      // Planks
      for (const p of planks) {
        g.fillStyle = '#c08a4e';
        g.strokeStyle = '#4a2a12';
        g.lineWidth = 3;
        g.beginPath(); g.rect(p.x - PW / 2, p.y - PH / 2, PW, PH); g.fill(); g.stroke();
        g.strokeStyle = 'rgba(80,45,15,.4)';
        g.lineWidth = 2;
        for (const fy of [-0.18, 0.15]) { g.beginPath(); g.moveTo(p.x - PW / 2 + 6, p.y + PH * fy); g.lineTo(p.x + PW / 2 - 6, p.y + PH * fy); g.stroke(); }
        for (const n of p.nails) {
          if (n.in) {
            g.fillStyle = '#555';
            g.beginPath(); g.arc(n.x, n.y, 5, 0, Math.PI * 2); g.fill();
          } else {
            const glow = 0.5 + 0.5 * Math.sin(performance.now() / 150);
            g.fillStyle = `rgba(255,215,60,${0.35 + glow * 0.35})`;
            g.beginPath(); g.arc(n.x, n.y, 16, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#d9d9d9';
            g.strokeStyle = '#333';
            g.lineWidth = 2;
            g.beginPath(); g.arc(n.x, n.y, 7, 0, Math.PI * 2); g.fill(); g.stroke();
          }
        }
      }

      // Hammer swing
      if (hammer) {
        hammer.t += dt;
        const k = Math.min(1, hammer.t / 0.15);
        g.save();
        g.translate(hammer.x + 18, hammer.y - 18);
        g.rotate(-1.1 + k * 1.1);
        g.font = '40px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('🔨', 0, 0);
        g.restore();
        if (hammer.t > 0.35) hammer = null;
      }
      g.restore();
    });
    cv.c.__patch = () => ({ leaks, planks, PW, PH }); // read by automated tests

    const near = (a, b, d) => Math.hypot(a.x - b.x, a.y - b.y) < d;
    cv.c.addEventListener('pointerdown', e => {
      if (!planks || finished) return;
      const pt = cv.pos(e);
      // Hammer a glowing nail
      for (const p of planks) {
        const n = p.nails.find(nl => !nl.in && near(nl, pt, 26));
        if (n) {
          n.in = true;
          hammer = { x: n.x, y: n.y, t: 0 };
          shake = 0.12;
          MR.Sfx.tone(160, 0.1, 'square', 0.16, 90);
          MR.vibrate(25);
          if (planks.every(pl => pl.leak && pl.nails.every(nl => nl.in))) {
            finished = true;
            MR.Sfx.good();
            ctx.hint('Hull patched! No more leaks.');
            setTimeout(ctx.done, 500);
          } else if (p.nails.every(nl => nl.in)) {
            ctx.hint(planks.every(pl => pl.leak) ? 'Keep hammering!' : 'Solid! Now the next leak.');
          }
          return;
        }
      }
      // Pick up a loose plank
      const p = planks.find(pl => !pl.leak && Math.abs(pl.x - pt.x) < PW / 2 + 8 && Math.abs(pl.y - pt.y) < PH / 2 + 12);
      if (!p) return;
      cv.c.setPointerCapture(e.pointerId);
      drag = p;
    });
    cv.c.addEventListener('pointermove', e => {
      if (!drag) return;
      Object.assign(drag, cv.pos(e));
    });
    const drop = () => {
      if (!drag) return;
      const lk = leaks.find(l => !l.patched && near(l, drag, PW * 0.6));
      if (lk) {
        lk.patched = true;
        drag.leak = lk;
        drag.x = lk.x;
        drag.y = lk.y;
        drag.nails = [{ x: lk.x - PW * 0.33, y: lk.y, in: false }, { x: lk.x + PW * 0.33, y: lk.y, in: false }];
        MR.Sfx.click();
        ctx.hint('Tap the glowing nails to hammer it in!');
      } else {
        drag.x = drag.home.x;
        drag.y = drag.home.y;
      }
      drag = null;
    };
    cv.c.addEventListener('pointerup', drop);
    cv.c.addEventListener('pointercancel', drop);
    return cv.stop;
  }

  return { ropes, chest, cannon, map: mapSwipe, bells, compass, grog, swab, anchor: anchorTask, patch };
})();
