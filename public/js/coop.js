// 🤝 Co-op mini-games (Teams). The server runs the game; these screens show both pirates'
// parts live and send taps. Each start(ctx) returns { update(state), cleanup() }.
// ctx = { stage, hint(text), send(data), myId, info(id) -> { name, color }, distTo(id) -> metres | null }
MR.Coop = (() => {
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Canvas filling an element, redrawn every frame.
  function canvasIn(parent, drawFn) {
    const c = el('canvas', 'mg-canvas');
    parent.appendChild(c);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0, alive = true;
    const loop = now => {
      if (!alive) return;
      const w = parent.clientWidth, h = parent.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      drawFn(g, w, h, now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return { c, stop: () => { alive = false; cancelAnimationFrame(raf); } };
  }

  function label(g, text, x, y, size, color = '#fff') {
    g.font = `700 ${size}px Fredoka, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(20,10,4,.85)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  // Shared frame: the game area, a control strip, and the "calling your crew" overlay.
  function frame(ctx, opts) {
    const root = el('div', 'coop');
    const art = el('div', 'coop-art');
    const side = el('div', 'coop-side');
    const wait = el('div', 'coop-wait hidden');
    root.append(art, side, wait);
    ctx.stage.appendChild(root);
    let state = null, got = 0;
    const partner = () => state && state.members.find(m => m.id !== ctx.myId);
    const msLeft = ms => Math.max(0, ms - (performance.now() - got));

    function renderWait() {
      const waiting = state && state.phase === 'waiting';
      wait.classList.toggle('hidden', !waiting);
      if (!waiting) return;
      const rows = state.crew.map(c => {
        const info = ctx.info(c.id);
        const d = ctx.distTo(c.id);
        const status = c.status === 'coming' ? `🏃 Coming${d != null ? ` · ${d} m` : ''}` : c.status === 'busy' ? '🔧 Busy in a task' : '⚪ Not answered yet';
        const li = el('li', `coop-mate ${c.status}`);
        const dot = el('span', 'dot');
        dot.style.background = info.color;
        li.append(dot, el('b', null, info.name), el('span', null, status));
        return li;
      });
      const where = state.type === 'vault' ? `Your crewmate goes to the other lock (${state.target.area}).` : 'Your crewmate comes here to help.';
      wait.replaceChildren(
        el('div', 'coop-wait-title', '🤝 Calling your crew…'),
        el('ul', 'coop-mates', null),
        el('p', 'coop-wait-hint', `${where} Tap ✕ to leave.`),
      );
      wait.querySelector('.coop-mates').replaceChildren(...rows);
    }

    const cv = canvasIn(art, (g, w, h, now) => opts.draw(g, w, h, now, state, { partner: partner(), msLeft }));
    let waitTimer = setInterval(() => { if (state && state.phase === 'waiting') renderWait(); }, 500);

    return {
      side,
      get state() { return state; },
      partner,
      msLeft,
      update(s) {
        state = s;
        got = performance.now();
        renderWait();
        if (opts.onState) opts.onState(s);
      },
      cleanup() {
        cv.stop();
        clearInterval(waitTimer);
        waitTimer = 0;
      },
    };
  }

  // A big button you press and hold (pointer or touch); reports on/off.
  function holdButton(parent, text, onChange) {
    const b = el('button', 'coop-btn hold');
    b.innerHTML = text;
    let down = false;
    const set = v => {
      if (v === down) return;
      down = v;
      b.classList.toggle('down', v);
      onChange(v);
    };
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); set(true); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => set(false));
    b.addEventListener('contextmenu', e => e.preventDefault());
    parent.appendChild(b);
    return { b, release: () => set(false) };
  }

  function roundRectPath(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // Skull and crossbones (size = skull radius), drawn in `color` with `hole` for eyes and teeth.
  function drawSkull(g, cx, cy, size, color, hole) {
    g.save();
    g.fillStyle = color;
    // Crossbones behind the skull
    for (const ang of [0.6, -0.6]) {
      g.save();
      g.translate(cx, cy + size * 0.55);
      g.rotate(ang);
      roundRectPath(g, -size * 1.35, -size * 0.12, size * 2.7, size * 0.24, size * 0.12);
      g.fill();
      for (const ex of [-1.35, 1.35]) for (const ey of [-0.15, 0.15]) {
        g.beginPath(); g.arc(ex * size, ey * size, size * 0.17, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
    // Skull and jaw
    g.beginPath(); g.arc(cx, cy - size * 0.1, size * 0.68, 0, Math.PI * 2); g.fill();
    roundRectPath(g, cx - size * 0.38, cy + size * 0.25, size * 0.76, size * 0.38, size * 0.1);
    g.fill();
    g.fillStyle = hole;
    for (const ex of [-0.26, 0.26]) { g.beginPath(); g.ellipse(cx + ex * size, cy - size * 0.1, size * 0.17, size * 0.2, 0, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.moveTo(cx, cy + size * 0.06); g.lineTo(cx - size * 0.08, cy + size * 0.2); g.lineTo(cx + size * 0.08, cy + size * 0.2); g.closePath(); g.fill();
    for (const tx of [-0.2, 0, 0.2]) g.fillRect(cx + tx * size - size * 0.025, cy + size * 0.36, size * 0.05, size * 0.22);
    g.restore();
  }

  // 🏴‍☠️ A Jolly Roger tied to a pole at (x, y), rippling in the wind.
  function drawFlag(g, x, y, fw, fh, t, wind = 1) {
    const N = 14;
    const wave = i => Math.sin(t * 6 * wind - i * 0.55) * fh * 0.09 * (i / N) * wind;
    g.save();
    g.beginPath();
    for (let i = 0; i <= N; i++) g.lineTo(x + (fw * i) / N, y + wave(i));
    for (let i = N; i >= 0; i--) g.lineTo(x + (fw * i) / N, y + fh + wave(i) * 1.1);
    g.closePath();
    g.fillStyle = '#151515';
    g.fill();
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    g.stroke();
    // Light and shade along the ripples
    for (let i = 1; i < N; i += 2) {
      const sh = Math.cos(t * 6 * wind - i * 0.55);
      g.fillStyle = sh > 0 ? `rgba(255,255,255,${0.06 * sh})` : `rgba(0,0,0,${-0.25 * sh})`;
      g.fillRect(x + (fw * i) / N, y + wave(i), fw / N + 0.5, fh);
    }
    if (fw > fh * 0.9) drawSkull(g, x + fw * 0.52, y + fh * 0.45 + wave(N / 2), fh * 0.25, '#f4f1e8', '#151515');
    g.restore();
  }

  // Clouds for the Mainsail sky: [x (0..1), y (0..1 of the sky), size, speed]
  const clouds = [[0.1, 0.25, 34, 12], [0.55, 0.15, 26, 8], [0.85, 0.4, 40, 15], [0.35, 0.55, 22, 10]];

  // ---------------- ⛵ Hoist the Mainsail ----------------
  function sail(ctx) {
    ctx.hint('Hold your crank together to raise the sail');
    let shown = 0; // smoothed progress
    const f = frame(ctx, {
      draw(g, w, h, now, s, { partner }) {
        const target = s ? s.progress : 0;
        shown += (target - shown) * 0.2;
        const t = now / 1000;
        const cx = w / 2, top = h * 0.05, bottom = h * 0.9;
        const horizon = h * 0.62;
        const holding = new Set(s ? s.hold : []);
        const pulling = holding.size > 0 && shown < 1;

        // Sky, drifting clouds, sea, deck
        const sky = g.createLinearGradient(0, 0, 0, horizon);
        sky.addColorStop(0, '#4fb0ea');
        sky.addColorStop(1, '#bfe6fb');
        g.fillStyle = sky;
        g.fillRect(0, 0, w, horizon);
        g.fillStyle = 'rgba(255,255,255,.85)';
        for (const [x0, y0, sz, sp] of clouds) {
          const x = ((x0 * w + t * sp) % (w + 160)) - 80, y = y0 * horizon;
          g.beginPath();
          g.ellipse(x, y, sz, sz * 0.45, 0, 0, Math.PI * 2);
          g.ellipse(x + sz * 0.6, y + 4, sz * 0.7, sz * 0.35, 0, 0, Math.PI * 2);
          g.ellipse(x - sz * 0.55, y + 5, sz * 0.6, sz * 0.3, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#2479a8';
        g.fillRect(0, horizon, w, bottom - horizon);
        g.strokeStyle = 'rgba(255,255,255,.35)';
        g.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const y = horizon + 8 + i * (bottom - horizon) / 4;
          g.beginPath();
          for (let x = 0; x <= w; x += 10) g.lineTo(x, y + Math.sin(x / 25 + t * 2 + i) * 2);
          g.stroke();
        }
        g.fillStyle = '#8b5a2b';
        g.fillRect(0, bottom - 22, w, h - bottom + 22);
        g.fillStyle = '#6b4423';
        for (let x = 0; x < w; x += 46) g.fillRect(x, bottom - 22, 2, h - bottom + 22);
        g.fillRect(0, bottom - 24, w, 4);

        // Mast (round wooden pole with iron bands) and the yard across it
        const yardY = top + (bottom - top) * 0.33;
        const yardW = Math.min(w * 0.56, (bottom - top) * 1.15);
        const mastG = g.createLinearGradient(cx - 9, 0, cx + 9, 0);
        mastG.addColorStop(0, '#5a3519'); mastG.addColorStop(0.45, '#9a6331'); mastG.addColorStop(1, '#4a2a12');
        g.fillStyle = mastG;
        g.fillRect(cx - 9, top, 18, bottom - 22 - top);
        g.fillStyle = '#3a3a3a';
        for (const y of [yardY + 40, (yardY + bottom) / 2, bottom - 50]) g.fillRect(cx - 10, y, 20, 4);
        g.fillStyle = '#d4a017';
        g.beginPath(); g.arc(cx, top, 7, 0, Math.PI * 2); g.fill(); // mast cap

        // Sail: unfurls down from the yard as you hoist, and fills with wind
        const fullL = bottom - 60 - yardY;
        const L = Math.max(0, fullL * shown);
        const half = yardW / 2;
        if (L > 4) {
          const billow = Math.min(1, L / fullL) * (10 + Math.sin(t * 1.6) * 3);
          const bl = { x: cx - half * 0.88, y: yardY + L }, br = { x: cx + half * 0.88, y: yardY + L };
          const sailPath = () => {
            g.beginPath();
            g.moveTo(cx - half, yardY + 6);
            g.lineTo(cx + half, yardY + 6);
            g.quadraticCurveTo(cx + half + billow * 0.6, yardY + L * 0.5, br.x, br.y);
            g.quadraticCurveTo(cx, br.y + billow * 1.6, bl.x, bl.y);
            g.quadraticCurveTo(cx - half - billow * 0.6, yardY + L * 0.5, cx - half, yardY + 6);
            g.closePath();
          };
          const cloth = g.createLinearGradient(cx - half, 0, cx + half, 0);
          cloth.addColorStop(0, '#d9c8a0'); cloth.addColorStop(0.5, '#fff8e6'); cloth.addColorStop(1, '#cdbb92');
          g.fillStyle = cloth;
          sailPath();
          g.fill();
          // Seams and the painted skull, kept inside the sail
          g.save();
          sailPath();
          g.clip();
          g.strokeStyle = 'rgba(150,120,80,.45)';
          g.lineWidth = 1.5;
          for (let i = 1; i < 6; i++) {
            const x = cx - half + (yardW * i) / 6;
            g.beginPath(); g.moveTo(x, yardY); g.quadraticCurveTo(x + (x - cx) * 0.05, yardY + L * 0.6, x, yardY + L + billow * 2); g.stroke();
          }
          if (L > 50) {
            const sz = Math.min(yardW * 0.13, L * 0.22);
            g.globalAlpha = Math.min(1, (L - 50) / 40) * 0.85;
            drawSkull(g, cx, yardY + L * 0.5 + billow * 0.4, sz, '#3b2412', '#fff8e6');
            g.globalAlpha = 1;
          }
          g.restore();
          g.strokeStyle = '#a8916a';
          g.lineWidth = 2.5;
          sailPath();
          g.stroke();
        }
        // Rolled-up sail still tied to the yard (gets thinner as it unrolls)
        const roll = 14 * (1 - shown) + 3;
        g.fillStyle = '#e8dcc0';
        g.strokeStyle = '#a8916a';
        g.lineWidth = 2;
        roundRectPath(g, cx - half, yardY - roll / 2 + 4, yardW, roll, roll / 2);
        g.fill(); g.stroke();
        // The yard (spar)
        g.fillStyle = '#5a3519';
        roundRectPath(g, cx - half - 10, yardY - 5, yardW + 20, 10, 5);
        g.fill();

        // 🏴‍☠️ Jolly Roger climbs the mast as you hoist
        // (it flies above the yard, so it never covers the sail)
        const fh = Math.min((yardY - top) * 0.5, 54), fw = (fh / 0.62) * (0.3 + 0.7 * shown); // unrolls as it climbs
        const flagTop = top + 6 + (1 - shown) * Math.max(0, yardY - 14 - fh - top - 6);
        g.strokeStyle = 'rgba(60,40,20,.8)';
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(cx + 10, top + 4); g.lineTo(cx + 10, yardY - 6); g.stroke(); // halyard
        drawFlag(g, cx + 10, flagTop, fw, fh, t, pulling ? 1.3 : 1);
        // Rigging from the yard ends down to the cranks
        const cranks = [{ x: w * 0.12, id: ctx.myId, name: 'You' }, { x: w * 0.88, id: partner ? partner.id : null, name: partner ? ctx.info(partner.id).name : (s && s.solo ? '' : 'Waiting…') }];
        if (s && s.solo) cranks.pop();
        for (const c of cranks) {
          const on = c.id && holding.has(c.id);
          g.strokeStyle = on ? '#e8d5a0' : '#8b6a45';
          g.lineWidth = on ? 3 : 2.5;
          g.beginPath(); g.moveTo(c.x < cx ? cx - half - 6 : cx + half + 6, yardY); g.lineTo(c.x, bottom - 40); g.stroke();
          const spin = on ? now / 120 : 0;
          g.save();
          g.translate(c.x, bottom - 40);
          if (on) { g.shadowColor = '#5dff7a'; g.shadowBlur = 22; }
          g.fillStyle = on ? '#3fa34d' : c.id ? '#6b4423' : '#4a3a2a';
          g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
          g.shadowBlur = 0;
          g.rotate(spin);
          g.fillStyle = '#d4a017';
          g.fillRect(-4, -24, 8, 48);
          g.fillRect(-24, -4, 48, 8);
          g.restore();
          label(g, c.name + (c.id ? (on ? ' ✋' : '') : ''), c.x, bottom - 4, 15, on ? '#9dffa9' : '#fff');
        }
        label(g, `${Math.round(shown * 100)}%`, cx - Math.min(w * 0.3, 160), top + 18, 20, '#ffd23c');
      },
      onState(s) {
        if (s.phase !== 'active') { btn.release(); ctx.hint('Waiting for a crewmate…'); return; }
        const p = f.partner();
        ctx.hint(s.solo ? 'Hold the crank to raise the sail (slowly, on your own)' : `Hold together with ${p ? ctx.info(p.id).name : 'your crewmate'}!`);
      },
    });
    const btn = holdButton(f.side, '✋<br>HOLD', on => ctx.send({ action: 'hold', on }));
    return { update: s => f.update(s), cleanup: () => { btn.release(); f.cleanup(); } };
  }

  // ---------------- 🪣 Pump the Bilge ----------------
  function pump(ctx) {
    ctx.hint('Take turns: pump when your side lights up');
    let tilt = 0, lastPumps = 0, splash = 0, wasMyTurn = false;
    const f = frame(ctx, {
      draw(g, w, h, now, s, { partner, msLeft }) {
        const myTurn = s && (s.solo || s.turn === ctx.myId);
        const jam = s ? msLeft(s.jamMs) : 0;
        const want = myTurn ? -0.32 : 0.32; // the handle dips toward whoever's turn it is
        tilt += (want - tilt) * 0.18;
        const cx = w / 2, py = h * 0.45;
        // Water
        const level = s ? 1 - s.pumps / s.need : 1;
        const wy = h - (h * 0.35) * level;
        g.fillStyle = 'rgba(40,120,170,.75)';
        g.beginPath();
        g.moveTo(0, h);
        for (let x = 0; x <= w; x += 12) g.lineTo(x, wy + Math.sin(x / 30 + now / 300) * 4);
        g.lineTo(w, h);
        g.closePath();
        g.fill();
        // Pump post + seesaw handle
        g.fillStyle = '#5a3519';
        g.fillRect(cx - 14, py, 28, h - py);
        g.save();
        g.translate(cx, py);
        if (jam > 0) g.rotate(Math.sin(now / 30) * 0.05);
        g.rotate(tilt);
        g.fillStyle = '#8b5a2b';
        g.fillRect(-w * 0.38, -9, w * 0.76, 18);
        g.restore();
        g.fillStyle = '#d4a017';
        g.beginPath(); g.arc(cx, py, 12, 0, Math.PI * 2); g.fill();
        // Handles: you on the left, crewmate on the right
        const ends = [{ x: cx - Math.cos(tilt) * w * 0.36, y: py - Math.sin(tilt) * w * 0.36, mine: true }, { x: cx + Math.cos(tilt) * w * 0.36, y: py + Math.sin(tilt) * w * 0.36, mine: false }];
        for (const e of ends) {
          const lit = s && !s.solo && (e.mine ? myTurn : !myTurn);
          g.save();
          if (lit && jam <= 0) { g.shadowColor = '#ffd23c'; g.shadowBlur = 24; }
          g.fillStyle = lit ? '#ffd23c' : '#6b4423';
          g.beginPath(); g.arc(e.x, e.y, 20, 0, Math.PI * 2); g.fill();
          g.restore();
          const nm = e.mine ? 'You' : partner ? ctx.info(partner.id).name : s && s.solo ? '' : 'Waiting…';
          label(g, nm, e.x, e.y - 36, 15, lit ? '#ffd23c' : '#fff');
        }
        if (splash > 0) {
          splash -= 0.03;
          for (let i = 0; i < 8; i++) label(g, '💧', cx + Math.cos(i) * 60 * (1 - splash), h * 0.8 - (1 - splash) * 50 + Math.sin(i * 3) * 10, 16);
        }
        if (s) label(g, `${s.pumps} / ${s.need}`, cx, h * 0.12, 20, '#ffd23c');
        if (jam > 0) label(g, '⚠️ JAMMED!', cx, h * 0.25, 26, '#ff6b6b');
      },
      onState(s) {
        if (s.pumps > lastPumps) splash = 1;
        lastPumps = s.pumps;
        if (s.phase !== 'active') { ctx.hint('Waiting for a crewmate…'); return; }
        const myTurn = s.solo || s.turn === ctx.myId;
        const p = f.partner();
        btn.classList.toggle('my-turn', myTurn);
        btn.innerHTML = myTurn ? '🪣<br>PUMP!' : `⏳<br>${p ? ctx.info(p.id).name : 'Wait'}`;
        if (myTurn && !wasMyTurn && !s.solo) MR.vibrate(30);
        wasMyTurn = myTurn;
        ctx.hint(s.solo ? 'Pump away (on your own)' : myTurn ? 'Your turn: PUMP!' : `Wait for ${p ? ctx.info(p.id).name : 'your crewmate'}… (pumping out of turn jams it)`);
      },
    });
    const btn = el('button', 'coop-btn pump', '🪣 PUMP');
    btn.addEventListener('pointerdown', e => { e.preventDefault(); ctx.send({ action: 'pump' }); });
    f.side.appendChild(btn);
    return { update: s => f.update(s), cleanup: () => f.cleanup() };
  }

  // ---------------- 🏦 Two-Key Vault ----------------

  // Dark stone blocks behind the vault doors.
  function drawStoneWall(g, w, h) {
    g.fillStyle = '#3a3530';
    g.fillRect(0, 0, w, h);
    const bh = 34, bw = 72;
    for (let row = 0, yy = 0; yy < h; row++, yy += bh) {
      for (let xx = (row % 2) * -bw / 2; xx < w; xx += bw) {
        const shade = 46 + ((row * 7 + Math.round(xx / bw) * 13) % 5) * 4;
        g.fillStyle = `rgb(${shade + 8},${shade + 2},${shade - 4})`;
        g.fillRect(xx + 2, yy + 2, bw - 4, bh - 4);
      }
    }
    // Soft light in the middle, darker corners
    const v = g.createRadialGradient(w / 2, h * 0.45, h * 0.2, w / 2, h * 0.45, w * 0.7);
    v.addColorStop(0, 'rgba(255,200,120,.12)');
    v.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
  }

  function drawGold(g, cx, cy, size, t) {
    for (let i = 0; i < 14; i++) {
      const x = cx + Math.sin(i * 2.4) * size, y = cy - Math.abs(Math.cos(i * 1.7)) * size * 0.25;
      g.fillStyle = i % 3 ? '#e8b923' : '#ffd95a';
      g.strokeStyle = '#8a6510';
      g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(x, y, 9, 5, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    const sp = (t * 0.7) % 1;
    g.fillStyle = `rgba(255,255,255,${1 - sp})`;
    const sx = cx + Math.sin(t) * size * 0.6, sy = cy - 8;
    g.beginPath(); g.moveTo(sx, sy - 7); g.lineTo(sx + 2, sy); g.lineTo(sx, sy + 7); g.lineTo(sx - 2, sy); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(sx - 7, sy); g.lineTo(sx, sy + 2); g.lineTo(sx + 7, sy); g.lineTo(sx, sy - 2); g.closePath(); g.fill();
  }

  // A round steel vault door: bolts round the rim (slide in as `open` goes 0 -> 1),
  // rivets, a brass keyhole plate and the key at angle `keyAng`.
  function drawVaultDoor(g, x, y, R, open, keyAng, t, empty) {
    g.save();
    // Bolts sticking out into the frame
    const bolts = 8;
    for (let i = 0; i < bolts; i++) {
      const a = (i / bolts) * Math.PI * 2 + Math.PI / 8;
      const out = R * (0.16 * (1 - open));
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.fillStyle = '#c0c6cc';
      g.strokeStyle = '#4a5058';
      g.lineWidth = 2;
      roundRectPath(g, R * 0.78, -R * 0.07, R * 0.22 + out, R * 0.14, R * 0.05);
      g.fill(); g.stroke();
      g.restore();
    }
    // Frame
    g.fillStyle = '#2a2d31';
    g.beginPath(); g.arc(x, y, R * 1.08, 0, Math.PI * 2); g.fill();
    // Door
    const steel = g.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R);
    steel.addColorStop(0, empty ? '#7c8188' : '#c9d0d6');
    steel.addColorStop(0.6, empty ? '#5a5f66' : '#8c949c');
    steel.addColorStop(1, empty ? '#3e4247' : '#5d646c');
    g.fillStyle = steel;
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3d4248';
    g.lineWidth = 3;
    g.stroke();
    // Inner ring + rivets
    g.strokeStyle = 'rgba(40,44,50,.6)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, R * 0.8, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rx = x + Math.cos(a) * R * 0.9, ry = y + Math.sin(a) * R * 0.9;
      g.fillStyle = '#e1e5e9';
      g.beginPath(); g.arc(rx, ry, R * 0.035 + 1, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.beginPath(); g.arc(rx + 1, ry + 1, R * 0.03, 0, Math.PI * 2); g.fill();
    }
    // Spoked handle wheel (turns a little as the bolts move)
    g.save();
    g.translate(x, y);
    g.rotate(open * Math.PI * 0.5);
    g.strokeStyle = '#6b737c';
    g.lineWidth = R * 0.07;
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(R * 0.62, 0); g.stroke();
      g.fillStyle = '#9aa2aa';
      g.beginPath(); g.arc(R * 0.62, 0, R * 0.07, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // Brass keyhole plate
    const brass = g.createRadialGradient(x - R * 0.1, y - R * 0.12, 2, x, y, R * 0.36);
    brass.addColorStop(0, '#ffe08a');
    brass.addColorStop(1, '#a8761a');
    g.fillStyle = brass;
    g.strokeStyle = '#6e4c0e';
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(x, y, R * 0.34, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#1a1208';
    g.beginPath(); g.arc(x, y - R * 0.05, R * 0.07, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(x - R * 0.04, y - R * 0.02); g.lineTo(x + R * 0.04, y - R * 0.02); g.lineTo(x + R * 0.06, y + R * 0.13); g.lineTo(x - R * 0.06, y + R * 0.13); g.closePath(); g.fill();
    // The key: an ornate bow sticking out of the keyhole
    if (!empty) {
      g.translate(x, y);
      g.rotate(keyAng);
      g.fillStyle = '#ffcc33';
      g.strokeStyle = '#7a5300';
      g.lineWidth = 2.5;
      roundRectPath(g, -R * 0.05, -R * 0.42, R * 0.1, R * 0.42, R * 0.03); // shank
      g.fill(); g.stroke();
      // Clover-shaped bow
      for (const [dx, dy] of [[0, -0.62], [-0.13, -0.52], [0.13, -0.52]]) {
        g.beginPath(); g.arc(dx * R, dy * R, R * 0.12, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      g.fillStyle = '#7a5300';
      g.beginPath(); g.arc(0, -R * 0.56, R * 0.05, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.6)';
      g.fillRect(-R * 0.02, -R * 0.38, R * 0.02, R * 0.3);
    }
    g.restore();
  }

  function drawLamp(g, x, y, on, t) {
    g.save();
    g.fillStyle = '#2a2d31';
    g.fillRect(x - 3, y + 6, 6, 8);
    const c = on ? '#5dff7a' : '#ff4d4d';
    g.shadowColor = c;
    g.shadowBlur = on ? 18 : 8 + Math.sin(t * 4) * 4;
    g.fillStyle = c;
    g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,.6)';
    g.beginPath(); g.arc(x - 2.5, y - 2.5, 2.5, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function drawPlaque(g, x, y, title, sub) {
    g.save();
    g.font = '700 14px Fredoka, sans-serif';
    const tw = Math.max(g.measureText(title).width, sub ? (g.font = '600 11px Fredoka, sans-serif', g.measureText(sub).width) : 0) + 20;
    const ph = sub ? 34 : 22;
    const brass = g.createLinearGradient(0, y - ph / 2, 0, y + ph / 2);
    brass.addColorStop(0, '#e6bc52');
    brass.addColorStop(1, '#9c6d16');
    g.fillStyle = brass;
    g.strokeStyle = '#5c3f0a';
    g.lineWidth = 2;
    roundRectPath(g, x - tw / 2, y - ph / 2, tw, ph, 5);
    g.fill(); g.stroke();
    g.fillStyle = '#3b2412';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 14px Fredoka, sans-serif';
    g.fillText(title, x, sub ? y - 7 : y + 1);
    if (sub) {
      g.font = '600 11px Fredoka, sans-serif';
      g.fillText(sub, x, y + 9);
    }
    g.restore();
  }

  function vault(ctx) {
    ctx.hint('Twist your key: drag round in a circle');
    let turnAngle = 0, dragging = null, sentAt = 0, wasTheirs = false;
    const open = [0, 0]; // how far each door's bolts have slid back (0..1)
    const f = frame(ctx, {
      draw(g, w, h, now, s, { partner, msLeft }) {
        const t = now / 1000;
        const you = s ? s.you : 0;
        const y = h * 0.47;
        const R = Math.min(w * 0.15, h * 0.28);
        const locks = [{ x: w * 0.28, mine: true }, { x: w * 0.72, mine: false }];
        f.keyAt = { x: locks[0].x, y, R };

        drawStoneWall(g, w, h);
        // Gold glinting on the floor between the doors
        drawGold(g, w / 2, h * 0.93, Math.min(w * 0.12, 70), t);

        locks.forEach((l, i) => {
          const idx = l.mine ? you : 1 - you;
          const left = s ? msLeft(s.turnedMs[idx]) : 0;
          const turned = left > 0;
          // Bolts slide back smoothly when the key turns
          open[i] += ((turned ? 1 : 0) - open[i]) * 0.15;
          const keyAng = turned ? Math.PI / 2 : l.mine ? turnAngle : 0;
          const empty = !l.mine && !partner && !(s && s.solo);
          drawVaultDoor(g, l.x, y, R, open[i], keyAng, t, empty);

          // Lamp above: red = locked, green = key turned
          drawLamp(g, l.x, y - R - 20, turned, t);
          // Countdown ring while a key is turned
          if (turned) {
            g.save();
            g.strokeStyle = '#7dff8e';
            g.shadowColor = '#7dff8e';
            g.shadowBlur = 12;
            g.lineWidth = 6;
            g.lineCap = 'round';
            g.beginPath(); g.arc(l.x, y, R + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / s.window)); g.stroke();
            g.restore();
            label(g, `${Math.ceil(left / 1000)}s`, l.x + R + 26, y - R + 4, 18, '#7dff8e');
          }
          // Brass plaque below with whose lock it is
          const who = l.mine ? 'Your lock' : partner ? `${ctx.info(partner.id).name}'s lock` : s && s.solo ? 'Other lock' : 'Waiting…';
          const where = l.mine || !s ? '' : s.areas[1 - you] || '';
          drawPlaque(g, l.x, y + R + 24, who, where);
        });

        // Drag guide round your key
        if (s && s.phase === 'active' && !(msLeft(s.turnedMs[you]) > 0)) {
          g.save();
          g.strokeStyle = 'rgba(255,210,60,.7)';
          g.setLineDash([6, 8]);
          g.lineDashOffset = -t * 20;
          g.lineWidth = 3;
          const a0 = -Math.PI / 2;
          g.beginPath(); g.arc(locks[0].x, y, R * 0.62, a0, a0 + Math.PI / 2 + 0.3); g.stroke();
          g.setLineDash([]);
          // Arrow head showing which way to turn
          const ae = a0 + Math.PI / 2 + 0.3;
          const ax = locks[0].x + Math.cos(ae) * R * 0.62, ay = y + Math.sin(ae) * R * 0.62;
          g.fillStyle = 'rgba(255,210,60,.9)';
          g.translate(ax, ay);
          g.rotate(ae + Math.PI / 2);
          g.beginPath(); g.moveTo(8, 0); g.lineTo(-6, -7); g.lineTo(-6, 7); g.closePath(); g.fill();
          g.restore();
        }
      },
      onState(s) {
        const p = f.partner();
        if (s.phase !== 'active') { ctx.hint('Waiting for a crewmate…'); return; }
        const mine = s.turnedMs[s.you] > 0, theirs = s.turnedMs[1 - s.you] > 0;
        if (theirs && !wasTheirs) MR.vibrate([80, 40, 80]);
        wasTheirs = theirs;
        if (theirs && !mine) ctx.hint('⏱️ Their key is turned! Turn yours NOW!');
        else if (mine && !theirs) ctx.hint(s.solo ? `Now run to the other lock (${s.target.area})!` : `Key turned! ${p ? ctx.info(p.id).name : 'Your crewmate'} has ${Math.round(s.window / 1000)}s to turn theirs`);
        else ctx.hint(s.solo ? 'Turn this key, then run to the other lock' : 'Twist your key: drag round in a circle');
        if (!mine) turnAngle = 0;
      },
    });
    // Twisting: follow the finger round the keyhole; a quarter-turn opens it.
    const art = ctx.stage.querySelector('.coop-art');
    const angleAt = e => {
      const r = art.getBoundingClientRect();
      const k = f.keyAt;
      return Math.atan2(e.clientY - r.top - k.y, e.clientX - r.left - k.x);
    };
    art.addEventListener('pointerdown', e => {
      const s = f.state;
      if (!s || s.phase !== 'active' || !f.keyAt) return;
      art.setPointerCapture(e.pointerId);
      dragging = angleAt(e);
    });
    art.addEventListener('pointermove', e => {
      if (dragging === null) return;
      const a = angleAt(e);
      let d = a - dragging;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      dragging = a;
      turnAngle = Math.max(0, Math.min(Math.PI / 2, turnAngle + d * 0.5));
      if (turnAngle >= Math.PI / 2 - 0.01 && performance.now() - sentAt > 600) {
        sentAt = performance.now();
        ctx.send({ action: 'turn' });
        MR.vibrate(40);
      }
    });
    for (const ev of ['pointerup', 'pointercancel']) art.addEventListener(ev, () => {
      dragging = null;
      const s = f.state;
      if (s && !(s.turnedMs[s.you] > 0) && performance.now() - sentAt > 600) turnAngle = 0;
    });
    f.side.appendChild(el('div', 'coop-twist', '↻'));
    f.side.appendChild(el('div', 'coop-twist-text', 'Drag round your key'));
    return { update: s => f.update(s), cleanup: () => f.cleanup() };
  }

  return { sail, pump, vault };
})();
