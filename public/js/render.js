// Drawing: ship deck (pre-rendered once), ocean, pirates, joystick.
MR.Render = (() => {
  const map = MR.Shared.map;
  const VIEW_H = 700; // world units visible vertically
  const PAD = { l: 260, t: 420, r: 260, b: 220 };
  let mapCanvas = null;

  // ---------- helpers ----------
  function rng(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const t = f < 0 ? 0 : 255, p = Math.abs(f);
    const ch = v => Math.round((t - v) * p + v);
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // Ship outline with a pointed bow at the top.
  function hullPath(g, inset) {
    const L = -70 + inset, R = map.W + 70 - inset, B = map.H + 70 - inset, T = -20 + inset;
    const bowY = -330 + inset * 1.6;
    g.beginPath();
    g.moveTo(L + 60, B);
    g.quadraticCurveTo(L, B, L, B - 60);
    g.lineTo(L, T);
    g.quadraticCurveTo(L + 80, bowY + 120, map.W / 2, bowY);
    g.quadraticCurveTo(R - 80, bowY + 120, R, T);
    g.lineTo(R, B - 60);
    g.quadraticCurveTo(R, B, R - 60, B);
    g.closePath();
  }

  // ---------- static map ----------
  function buildMap() {
    const c = document.createElement('canvas');
    c.width = map.W + PAD.l + PAD.r;
    c.height = map.H + PAD.t + PAD.b;
    const g = c.getContext('2d');
    g.translate(PAD.l, PAD.t);

    // Hull
    hullPath(g, 0);
    g.fillStyle = '#3f2410';
    g.fill();
    hullPath(g, 10);
    g.fillStyle = '#5e3618';
    g.fill();

    // Deck floor
    g.save();
    hullPath(g, 30);
    g.clip();
    g.fillStyle = '#b98a55';
    g.fillRect(-PAD.l, -PAD.t, c.width, c.height);
    for (const a of map.areas) {
      g.fillStyle = a.floor;
      g.fillRect(a.x, a.y, a.w, a.h);
    }
    drawPlanks(g);
    g.restore();

    // Railing
    hullPath(g, 30);
    g.lineWidth = 12;
    g.strokeStyle = '#7a4b26';
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = '#2e1909';
    g.stroke();

    // Floor props first (rugs, gold piles), then everything else.
    for (const p of map.props) if (p.solid === false) drawProp(g, p);

    // Wall shadows, then walls
    g.fillStyle = 'rgba(0,0,0,.2)';
    for (const w of map.walls) g.fillRect(w.x + 4, w.y + 8, w.w, w.h);
    for (const w of map.walls) {
      g.fillStyle = '#5a3519';
      g.fillRect(w.x, w.y, w.w, w.h);
      g.fillStyle = '#7d4d27';
      g.fillRect(w.x, w.y, w.w, Math.min(6, w.h));
    }

    for (const p of map.props) if (p.solid !== false) drawProp(g, p);

    // Area names
    g.font = '30px "Pirata One", serif';
    g.textBaseline = 'top';
    g.fillStyle = 'rgba(255,240,210,.6)';
    for (const a of map.areas) {
      if (a.id === 'deck') {
        g.textAlign = 'center';
        g.fillText(a.name, a.x + a.w / 2, a.y + 330);
      } else {
        g.textAlign = 'left';
        g.fillText(a.name, a.x + 24, a.y + 22);
      }
    }

    mapCanvas = c;
  }

  function drawPlanks(g) {
    const rand = rng(1234567);
    const ROW = 32;
    g.strokeStyle = 'rgba(50,28,10,.28)';
    g.lineWidth = 2;
    for (let y = -400; y < map.H + 100; y += ROW) {
      g.beginPath();
      g.moveTo(-200, y);
      g.lineTo(map.W + 200, y);
      g.stroke();
      let x = -200 + rand() * 200;
      while (x < map.W + 200) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + ROW);
        g.stroke();
        x += 180 + rand() * 120;
      }
    }
    // Subtle grain
    g.fillStyle = 'rgba(255,255,255,.04)';
    for (let i = 0; i < 1400; i++) {
      g.fillRect(-100 + rand() * (map.W + 200), -380 + rand() * (map.H + 450), 30 + rand() * 60, 2);
    }
  }

  function drawProp(g, p) {
    const { x, y, w, h } = p;
    const cx = x + w / 2, cy = y + h / 2;
    g.save();
    g.lineJoin = 'round';
    switch (p.type) {
      case 'mast': {
        // Ropes radiating from the mast
        g.strokeStyle = 'rgba(70,45,20,.7)';
        g.lineWidth = 4;
        for (const [dx, dy] of [[-150, -120], [150, -120], [-150, 120], [150, 120]]) {
          g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + dx, cy + dy); g.stroke();
        }
        g.fillStyle = 'rgba(0,0,0,.25)';
        g.beginPath(); g.arc(cx + 6, cy + 10, w / 2 + 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#5a3519';
        g.beginPath(); g.arc(cx, cy, w / 2 + 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#8b5a2b';
        g.beginPath(); g.arc(cx, cy, w / 2 - 4, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#5a3519'; g.lineWidth = 3;
        g.beginPath(); g.arc(cx, cy, w / 4, 0, Math.PI * 2); g.stroke();
        break;
      }
      case 'wheel': {
        g.strokeStyle = '#4a2a12'; g.lineWidth = 6;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.beginPath(); g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(a) * (w / 2 + 8), cy + Math.sin(a) * (w / 2 + 8)); g.stroke();
        }
        g.strokeStyle = '#7a4b26'; g.lineWidth = 8;
        g.beginPath(); g.arc(cx, cy, w / 2 - 6, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#d4a017';
        g.beginPath(); g.arc(cx, cy, 8, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'crate': {
        g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x + 5, y + 8, w, h);
        g.fillStyle = '#b07a3c'; g.fillRect(x, y, w, h);
        g.strokeStyle = '#6b4423'; g.lineWidth = 4; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
        g.beginPath(); g.moveTo(x + 4, y + 4); g.lineTo(x + w - 4, y + h - 4);
        g.moveTo(x + w - 4, y + 4); g.lineTo(x + 4, y + h - 4); g.stroke();
        break;
      }
      case 'barrel': {
        const r = w / 2;
        g.fillStyle = 'rgba(0,0,0,.22)';
        g.beginPath(); g.arc(cx + 4, cy + 7, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#8b5a2b';
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#3d2a1a'; g.lineWidth = 4;
        g.beginPath(); g.arc(cx, cy, r - 2, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.arc(cx, cy, r * 0.6, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#a06b38';
        g.beginPath(); g.arc(cx, cy, r * 0.6 - 2, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'table': {
        g.fillStyle = 'rgba(0,0,0,.2)'; roundRect(g, x + 5, y + 8, w, h, 10); g.fill();
        g.fillStyle = '#7a4a24'; roundRect(g, x, y, w, h, 10); g.fill();
        g.strokeStyle = '#4a2a12'; g.lineWidth = 3; g.stroke();
        // Candle and plates
        g.fillStyle = '#f1e3c0';
        g.beginPath(); g.arc(x + w * 0.3, cy, 12, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(x + w * 0.7, cy, 12, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffcf5a';
        g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'maptable': {
        g.fillStyle = 'rgba(0,0,0,.2)'; roundRect(g, x + 5, y + 8, w, h, 10); g.fill();
        g.fillStyle = '#6b4423'; roundRect(g, x, y, w, h, 10); g.fill();
        g.fillStyle = '#e8d5a3'; g.fillRect(x + 16, y + 14, w - 32, h - 28);
        g.strokeStyle = '#a0522d'; g.lineWidth = 2; g.setLineDash([6, 6]);
        g.beginPath(); g.moveTo(x + 30, y + h - 26); g.quadraticCurveTo(cx, y + 20, x + w - 50, cy); g.stroke();
        g.setLineDash([]);
        g.strokeStyle = '#c0392b'; g.lineWidth = 4;
        const mx = x + w - 50, my = cy;
        g.beginPath(); g.moveTo(mx - 8, my - 8); g.lineTo(mx + 8, my + 8);
        g.moveTo(mx + 8, my - 8); g.lineTo(mx - 8, my + 8); g.stroke();
        break;
      }
      case 'stove': {
        g.fillStyle = '#3a3a3a'; roundRect(g, x, y, w, h, 8); g.fill();
        g.strokeStyle = '#222'; g.lineWidth = 3; g.stroke();
        for (const fx of [x + w * 0.3, x + w * 0.7]) {
          g.fillStyle = '#ff8a3d';
          g.beginPath(); g.arc(fx, cy, 16, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#ffd36b';
          g.beginPath(); g.arc(fx, cy, 8, 0, Math.PI * 2); g.fill();
        }
        break;
      }
      case 'ladder': {
        g.strokeStyle = '#5a3519'; g.lineWidth = 7;
        g.beginPath(); g.moveTo(x + 10, y); g.lineTo(x + 10, y + h);
        g.moveTo(x + w - 10, y); g.lineTo(x + w - 10, y + h); g.stroke();
        g.lineWidth = 5;
        for (let yy = y + 12; yy < y + h; yy += 22) {
          g.beginPath(); g.moveTo(x + 10, yy); g.lineTo(x + w - 10, yy); g.stroke();
        }
        break;
      }
      case 'ropecoil': {
        g.strokeStyle = '#c9a76a'; g.lineWidth = 5;
        for (let r = w / 2; r > 6; r -= 9) {
          g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
        }
        break;
      }
      case 'rack': {
        g.fillStyle = '#5a3519'; g.fillRect(x, y, w, h);
        g.strokeStyle = '#cfd6dc'; g.lineWidth = 4;
        for (let yy = y + 20; yy < y + h - 10; yy += 34) {
          g.beginPath(); g.moveTo(x - 14, yy); g.lineTo(x + w - 6, yy + 8); g.stroke();
        }
        break;
      }
      case 'cannon': {
        g.fillStyle = 'rgba(0,0,0,.25)'; roundRect(g, x + 4, y + 8, w, h, h / 2); g.fill();
        g.fillStyle = '#5a3519'; g.fillRect(x + 10, y - 4, 50, h + 8);
        g.fillStyle = '#2f2f2f'; roundRect(g, x, y + 8, w, h - 16, (h - 16) / 2); g.fill();
        g.fillStyle = '#151515';
        g.beginPath(); g.arc(x + w - 4, cy, 9, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'balls': {
        g.fillStyle = '#262626';
        for (const [bx, by] of [[0.3, 0.35], [0.7, 0.35], [0.5, 0.7], [0.25, 0.75], [0.75, 0.75]]) {
          g.beginPath(); g.arc(x + w * bx, y + h * by, 12, 0, Math.PI * 2); g.fill();
        }
        break;
      }
      case 'cell': {
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y, w, h);
        g.strokeStyle = '#3c3c3c'; g.lineWidth = 6; g.strokeRect(x, y, w, h);
        g.lineWidth = 4;
        for (let bx = x + 16; bx < x + w; bx += 18) {
          g.beginPath(); g.moveTo(bx, y); g.lineTo(bx, y + h); g.stroke();
        }
        break;
      }
      case 'chest': {
        g.fillStyle = 'rgba(0,0,0,.22)'; roundRect(g, x + 4, y + 8, w, h, 8); g.fill();
        g.fillStyle = '#8b5a2b'; roundRect(g, x, y, w, h, 8); g.fill();
        g.fillStyle = '#d4a017';
        g.fillRect(x, y + h * 0.38, w, 7);
        g.fillRect(x + w * 0.2, y, 7, h);
        g.fillRect(x + w * 0.8 - 7, y, 7, h);
        g.fillRect(cx - 7, y + h * 0.3, 14, 16);
        break;
      }
      case 'gold': {
        const rand = rng(99);
        for (let i = 0; i < 40; i++) {
          const a = rand() * Math.PI * 2, d = rand();
          const gx = cx + Math.cos(a) * d * w / 2, gy = cy + Math.sin(a) * d * h / 2;
          g.fillStyle = i % 3 ? '#e8b923' : '#ffd95a';
          g.beginPath(); g.ellipse(gx, gy, 9, 6, 0, 0, Math.PI * 2); g.fill();
          g.strokeStyle = '#a77d0f'; g.lineWidth = 1.5; g.stroke();
        }
        break;
      }
      case 'rug': {
        g.fillStyle = '#8e2b2b'; roundRect(g, x, y, w, h, 14); g.fill();
        g.strokeStyle = '#d4a017'; g.lineWidth = 5; roundRect(g, x + 12, y + 12, w - 24, h - 24, 10); g.stroke();
        break;
      }
    }
    g.restore();
  }

  // ---------- per frame ----------
  function drawOcean(g, cam, vw, vh, t) {
    g.fillStyle = '#1b5e7a';
    g.fillRect(cam.x - vw / 2, cam.y - vh / 2, vw, vh);
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.lineWidth = 3;
    const step = 90;
    const x0 = Math.floor((cam.x - vw / 2) / step) * step - step;
    const y0 = Math.floor((cam.y - vh / 2) / step) * step - step;
    for (let y = y0; y < cam.y + vh / 2 + step; y += step) {
      for (let x = x0; x < cam.x + vw / 2 + step; x += step * 2) {
        const off = ((y / step) % 2) * step + Math.sin(t * 0.8 + y * 0.05) * 20;
        g.beginPath();
        g.arc(x + off, y, 18, Math.PI * 1.15, Math.PI * 1.85);
        g.stroke();
      }
    }
  }

  function drawPirate(g, p, t) {
    if ((p.status || []).includes('offline')) {
      // Faded while their connection is down
      g.save();
      g.globalAlpha = 0.4;
      drawPirate(g, { ...p, status: p.status.filter(s => s !== 'offline'), name: p.name + ' 📴' }, t);
      g.restore();
      return;
    }
    const color = p.color || '#cccccc';
    const bob = p.moving ? -Math.abs(Math.sin(p.walk)) * 5 : Math.sin(t * 2 + p.x) * 1;
    const step = p.moving ? Math.sin(p.walk) * 6 : 0;

    // Shadow
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.ellipse(p.x, p.y + 26, 24, 8, 0, 0, Math.PI * 2); g.fill();

    const status = p.status || [];
    if (status.includes('slime')) {
      // Slime puddle under a slowed pirate
      g.fillStyle = 'rgba(80,200,90,.45)';
      g.beginPath(); g.ellipse(p.x, p.y + 26, 34, 11, 0, 0, Math.PI * 2); g.fill();
    }

    g.save();
    g.translate(p.x, p.y);
    g.scale(p.face, 1);

    // Feet
    g.fillStyle = shade(color, -0.45);
    g.beginPath(); g.ellipse(-10 + step, 24, 9, 6, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(10 - step, 24, 9, 6, 0, 0, Math.PI * 2); g.fill();

    g.translate(0, bob);

    // Body
    roundRect(g, -22, -24, 44, 48, 20);
    g.fillStyle = color; g.fill();
    g.lineWidth = 3; g.strokeStyle = shade(color, -0.5); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.25)';
    g.beginPath(); g.ellipse(-8, 6, 6, 10, 0.3, 0, Math.PI * 2); g.fill();

    // Eye + eyepatch
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(9, -6, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111';
    g.beginPath(); g.arc(11, -6, 3.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-22, -16); g.lineTo(18, -2); g.stroke();
    g.beginPath(); g.ellipse(-7, -8, 6, 5, 0, 0, Math.PI * 2); g.fill();

    // Tricorn hat
    g.fillStyle = '#1e1e1e';
    g.beginPath();
    g.moveTo(-28, -20);
    g.quadraticCurveTo(-18, -30, -12, -40);
    g.quadraticCurveTo(0, -50, 12, -40);
    g.quadraticCurveTo(18, -30, 28, -20);
    g.quadraticCurveTo(0, -28, -28, -20);
    g.fill();
    g.strokeStyle = '#d4a017'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-24, -21); g.quadraticCurveTo(0, -29, 24, -21); g.stroke();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(0, -36, 3.5, 0, Math.PI * 2); g.fill();

    if (status.includes('slime')) {
      // Dripping slime on the body
      g.fillStyle = 'rgba(80,200,90,.85)';
      for (const [dx, len] of [[-12, 10], [2, 16], [14, 8]]) {
        const drip = len + Math.sin(t * 4 + dx) * 4;
        roundRect(g, dx - 4, -22, 8, 14 + drip, 4);
        g.fill();
      }
    }
    g.restore();

    if (status.includes('wind')) {
      // 💨 Speed streaks trailing behind
      g.save();
      g.strokeStyle = 'rgba(255,255,255,.75)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      for (const [dy, len] of [[-14, 26], [0, 34], [14, 22]]) {
        const off = (t * 120 + dy * 7) % 18;
        const x0 = p.x - p.face * (30 + off);
        g.beginPath(); g.moveTo(x0, p.y + dy + bob); g.lineTo(x0 - p.face * len, p.y + dy + bob); g.stroke();
      }
      g.restore();
    }
    if (status.includes('rum')) {
      // 🍺 Dizzy stars circling above the name
      g.save();
      g.font = '20px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffe14d';
      g.strokeStyle = 'rgba(0,0,0,.5)';
      g.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + (i * Math.PI * 2) / 3;
        const sx = p.x + Math.cos(a) * 28, sy = p.y - 76 + bob + Math.sin(a) * 6;
        g.strokeText('★', sx, sy);
        g.fillText('★', sx, sy);
      }
      g.restore();
    }
    if (status.includes('storm')) {
      // ⛈️ Little rain cloud over their head
      g.save();
      const cx = p.x, cy = p.y - 92 + bob;
      g.fillStyle = 'rgba(70,80,100,.9)';
      for (const [dx, r] of [[-12, 11], [0, 15], [13, 10]]) {
        g.beginPath(); g.arc(cx + dx, cy, r, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(160,200,255,.9)';
      g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const dy = (t * 60 + i * 9) % 18;
        g.beginPath(); g.moveTo(cx - 10 + i * 10, cy + 10 + dy); g.lineTo(cx - 12 + i * 10, cy + 16 + dy); g.stroke();
      }
      g.restore();
    }
    if (status.includes('net')) {
      // 🥅 Rope net thrown over them
      g.save();
      const cx = p.x, cy = p.y - 4;
      g.beginPath(); g.arc(cx, cy, 40, 0, Math.PI * 2); g.clip();
      g.strokeStyle = 'rgba(214,190,140,.95)';
      g.lineWidth = 3;
      const wob = Math.sin(t * 6) * 2;
      for (let d = -48; d <= 48; d += 12) {
        g.beginPath(); g.moveTo(cx + d - 48, cy - 48 + wob); g.lineTo(cx + d + 48, cy + 48 + wob); g.stroke();
        g.beginPath(); g.moveTo(cx + d + 48, cy - 48 - wob); g.lineTo(cx + d - 48, cy + 48 - wob); g.stroke();
      }
      g.restore();
      g.strokeStyle = 'rgba(120,90,50,.95)';
      g.lineWidth = 4;
      g.beginPath(); g.arc(p.x, p.y - 4, 40, 0, Math.PI * 2); g.stroke();
      // Little floats on the rim
      g.fillStyle = '#e74c3c';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        g.beginPath(); g.arc(p.x + Math.cos(a) * 40, p.y - 4 + Math.sin(a) * 40, 4, 0, Math.PI * 2); g.fill();
      }
    }
    if (status.includes('coin')) {
      // Golden shield bubble
      g.save();
      g.strokeStyle = `rgba(255,210,60,${0.6 + 0.3 * Math.sin(t * 5)})`;
      g.fillStyle = 'rgba(255,210,60,.12)';
      g.lineWidth = 4;
      g.beginPath(); g.arc(p.x, p.y - 6 + bob, 46, 0, Math.PI * 2); g.fill(); g.stroke();
      g.restore();
    }

    // Name tag
    g.font = '600 16px Fredoka, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(0,0,0,.6)';
    g.strokeText(p.name, p.x, p.y - 52 + bob);
    g.fillStyle = p.isMe ? '#ffe28a' : '#fff';
    g.fillText(p.name, p.x, p.y - 52 + bob);
  }

  // Smuggler's Key lying on the deck: a spinning, glowing gold key.
  function drawKey(g, b, time) {
    const bob = Math.sin(time * 3 + b.id) * 5;
    const x = b.x, y = b.y + bob;
    g.save();
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.ellipse(b.x, b.y + 24, 20, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(255,215,80,${0.3 + 0.2 * Math.sin(time * 5)})`;
    g.beginPath(); g.arc(x, y, 38, 0, Math.PI * 2); g.fill();

    g.translate(x, y);
    g.rotate(-0.6 + Math.sin(time * 1.5 + b.id) * 0.25);
    g.scale(1.3, 1.3);
    g.lineJoin = 'round';
    g.fillStyle = '#ffcc33';
    g.strokeStyle = '#7a5300';
    g.lineWidth = 3;
    // Bow (the ring you hold)
    g.beginPath(); g.arc(-16, 0, 12, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#7a5300';
    g.beginPath(); g.arc(-16, 0, 5, 0, Math.PI * 2); g.fill();
    // Shaft
    g.fillStyle = '#ffcc33';
    g.beginPath(); g.rect(-5, -4, 30, 8); g.fill(); g.stroke();
    // Teeth
    g.beginPath(); g.rect(16, 4, 6, 9); g.fill(); g.stroke();
    g.beginPath(); g.rect(8, 4, 5, 6); g.fill(); g.stroke();
    // Shine
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.fillRect(-2, -2, 18, 2);
    g.restore();

    // Sparkle
    const sa = time * 2.5 + b.id;
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(x + Math.cos(sa) * 28, y - 14 + Math.sin(sa) * 10, 3, 0, Math.PI * 2); g.fill();
  }

  // Mystery barrel bobbing in place with a "?".
  function drawBarrel(g, b, time) {
    if (b.kind === 'key') return drawKey(g, b, time);
    const bob = Math.sin(time * 3 + b.id) * 4;
    const x = b.x, y = b.y + bob;
    g.save();
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.ellipse(b.x, b.y + 26, 24, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(255,230,120,${0.25 + 0.15 * Math.sin(time * 5)})`;
    g.beginPath(); g.arc(x, y, 40, 0, Math.PI * 2); g.fill();
    // Side-on barrel
    roundRect(g, x - 22, y - 28, 44, 54, 14);
    g.fillStyle = '#9a6331'; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#4a2a12'; g.stroke();
    g.fillStyle = '#3d2a1a';
    g.fillRect(x - 22, y - 16, 44, 5);
    g.fillRect(x - 22, y + 10, 44, 5);
    g.fillStyle = '#ffe28a';
    g.font = '700 26px Fredoka, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 4; g.strokeStyle = '#4a2a12';
    g.strokeText('?', x, y - 1);
    g.fillText('?', x, y - 1);
    // Sparkle
    const sa = time * 2 + b.id;
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(x + Math.cos(sa) * 30, y - 20 + Math.sin(sa) * 10, 3, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // Smuggler's hatch (only drawn for players holding the key).
  function drawHatch(g, h, time, current) {
    g.save();
    const glow = 0.5 + 0.5 * Math.sin(time * 4 + h.x);
    g.shadowColor = '#ffd23c';
    g.shadowBlur = 20 + glow * 14;
    g.fillStyle = current ? '#1a0f05' : '#5a3519';
    g.fillRect(h.x - 34, h.y - 34, 68, 68);
    g.shadowBlur = 0;
    g.strokeStyle = `rgba(255,210,60,${0.6 + glow * 0.4})`;
    g.lineWidth = 5;
    g.strokeRect(h.x - 34, h.y - 34, 68, 68);
    if (!current) {
      g.strokeStyle = '#3d2210';
      g.lineWidth = 3;
      for (let i = -1; i <= 1; i++) {
        g.beginPath(); g.moveTo(h.x - 30, h.y + i * 18); g.lineTo(h.x + 30, h.y + i * 18); g.stroke();
      }
      g.fillStyle = '#d4a017';
      g.beginPath(); g.arc(h.x + 20, h.y, 5, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  // Glowing ring + bouncing marker on your own unfinished task stations.
  function drawStation(g, t, icon, time) {
    if (t.locked) {
      // Anchored: grey ring with chains and a countdown.
      g.save();
      g.strokeStyle = 'rgba(80,80,80,.9)';
      g.lineWidth = 6;
      g.setLineDash([8, 6]);
      g.beginPath(); g.arc(t.x, t.y, 40, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      g.font = '34px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('⚓', t.x, t.y - 64);
      g.font = '700 18px Fredoka, sans-serif';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.7)';
      g.strokeText(`${t.lockedLeft}s`, t.x, t.y - 34);
      g.fillStyle = '#fff';
      g.fillText(`${t.lockedLeft}s`, t.x, t.y - 34);
      g.restore();
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    g.save();
    g.fillStyle = `rgba(255, 210, 60, ${0.15 + pulse * 0.15})`;
    g.beginPath(); g.arc(t.x, t.y, 44, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffd23c';
    g.lineWidth = 5;
    g.setLineDash([14, 10]);
    g.lineDashOffset = -time * 30;
    g.beginPath(); g.arc(t.x, t.y, 40, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);

    const by = t.y - 74 - Math.abs(Math.sin(time * 3)) * 10;
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.ellipse(t.x, t.y - 4, 16, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd23c';
    g.strokeStyle = '#7a5300';
    g.lineWidth = 3;
    g.beginPath(); g.arc(t.x, by, 22, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(t.x - 8, by + 19); g.lineTo(t.x, by + 32); g.lineTo(t.x + 8, by + 19); g.fill();
    g.font = '24px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(icon, t.x, by + 1);
    g.restore();
  }

  // Arrows at the screen edge pointing to off-screen tasks (screen space).
  function drawEdgeArrows(g, tasks, toScreen, cw, ch) {
    const M = 46;
    for (const t of tasks) {
      const p = toScreen(t.x, t.y);
      if (p.x > M && p.x < cw - M && p.y > M && p.y < ch - M) continue;
      const cx = cw / 2, cy = ch / 2;
      const dx = p.x - cx, dy = p.y - cy;
      const k = Math.min((cw / 2 - M) / Math.abs(dx || 1e-6), (ch / 2 - M) / Math.abs(dy || 1e-6));
      let ax = cx + dx * k, ay = cy + dy * k;
      // Keep arrows out of the joystick (bottom-left) and button (bottom-right) corners.
      if (ay > ch - 150) {
        if (ax < 190) { ax = Math.max(ax, M); ay = ch - 150; }
        else if (ax > cw - 250) { ax = Math.min(ax, cw - M); ay = ch - 150; }
      }
      const ang = Math.atan2(dy, dx);
      g.save();
      g.translate(ax, ay);
      g.fillStyle = 'rgba(20,32,46,.75)';
      g.beginPath(); g.arc(0, 0, 20, 0, Math.PI * 2); g.fill();
      g.font = '20px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t.icon, 0, 1);
      g.rotate(ang);
      g.fillStyle = '#ffd23c';
      g.strokeStyle = '#7a5300';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(32, 0); g.lineTo(21, -9); g.lineTo(21, 9); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  }

  // ---------- particles ----------
  let bursts = [];   // world space: task-complete sparkles
  let coins = [];    // screen space: win confetti

  function burst(x, y) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 220;
      bursts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, life: 0.8 + Math.random() * 0.4, c: i % 2 ? '#ffd23c' : '#ffffff' });
    }
  }

  // Dust cloud when someone climbs out of a hatch.
  function puff(x, y) {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 120;
      bursts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.6 + Math.random() * 0.5, c: i % 2 ? '#c9b48a' : '#8f7a5a' });
    }
  }

  function confetti(cw) {
    coins = [];
    for (let i = 0; i < 140; i++) {
      coins.push({ x: Math.random() * cw, y: -20 - Math.random() * 600, vy: 120 + Math.random() * 160, vx: -30 + Math.random() * 60, spin: Math.random() * 6, s: 6 + Math.random() * 6 });
    }
  }

  function stepParticles(g, dt, worldSpace, ch) {
    if (worldSpace) {
      bursts = bursts.filter(b => (b.life -= dt) > 0);
      for (const b of bursts) {
        b.vy += 400 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
        g.globalAlpha = Math.min(1, b.life * 2);
        g.fillStyle = b.c;
        g.fillRect(b.x - 4, b.y - 4, 8, 8);
      }
      g.globalAlpha = 1;
      return;
    }
    coins = coins.filter(c => c.y < ch + 30);
    for (const c of coins) {
      c.y += c.vy * dt; c.x += c.vx * dt; c.spin += dt * 6;
      const sx = Math.abs(Math.cos(c.spin)) * c.s + 1;
      g.fillStyle = '#ffd23c';
      g.strokeStyle = '#a77d0f';
      g.lineWidth = 2;
      g.beginPath(); g.ellipse(c.x, c.y, sx, c.s, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }

  // ⛈️ Dark sky, slanted rain and the odd lightning flash (screen space).
  function drawStorm(g, cw, ch, t) {
    g.fillStyle = 'rgba(15,25,45,.35)';
    g.fillRect(0, 0, cw, ch);
    g.strokeStyle = 'rgba(200,220,255,.45)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 90; i++) {
      // Each drop falls on its own loop; positions come from i so no state is needed.
      const speed = 700 + (i * 37) % 300;
      const x0 = (i * 97.3) % (cw + 200) - 100;
      const y = ((t * speed + i * 53) % (ch + 60)) - 30;
      const x = x0 + (y * 0.35);
      g.moveTo(x, y);
      g.lineTo(x + 7, y + 20);
    }
    g.stroke();
    const flash = Math.sin(t * 0.9) * Math.sin(t * 2.3 + 1);
    if (flash > 0.93) {
      g.fillStyle = `rgba(255,255,255,${(flash - 0.93) * 6})`;
      g.fillRect(0, 0, cw, ch);
    }
  }

  // Covers the screen except a soft circle around you (fog / hatch).
  function drawDarkness(g, cw, ch, c, r, color) {
    const grad = g.createRadialGradient(c.x, c.y, r * 0.6, c.x, c.y, r * 1.5);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
  }

  function drawJoystick(g, joy, R, showHint, h) {
    let bx = joy.bx, by = joy.by, kx = joy.kx, ky = joy.ky, alpha = 1;
    if (!joy.active) {
      if (!showHint) return;
      bx = 110; by = h - 110; kx = 0; ky = 0; alpha = 0.45;
    }
    g.globalAlpha = alpha;
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.strokeStyle = 'rgba(255,255,255,.5)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(bx, by, R, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.beginPath(); g.arc(bx + kx, by + ky, 28, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }

  function draw(canvas, s) {
    const g = canvas.getContext('2d');
    const dpr = s.dpr;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const zoom = Math.max(0.45, Math.min(1.4, ch / VIEW_H));
    const vw = cw / zoom, vh = ch / zoom;

    // Camera follows you, but doesn't drift too far past the ship.
    const cam = {
      x: Math.max(vw / 2 - 300, Math.min(map.W - vw / 2 + 300, s.me.x)),
      y: Math.max(vh / 2 - 450, Math.min(map.H - vh / 2 + 260, s.me.y)),
    };
    if (vw > map.W + 600) cam.x = map.W / 2;

    // Gentle rocking of the ship (can be turned off in Settings)
    let sway = s.sway ? Math.sin(s.time * 0.55) * 0.012 : 0;
    let heave = s.sway ? Math.sin(s.time * 0.8) * 3 : 0;
    if (s.storm) {
      // ⛈️ The ship pitches hard in a storm (always, even with sway off)
      sway = Math.sin(s.time * 1.3) * 0.06 + Math.sin(s.time * 2.7) * 0.02;
      heave = Math.sin(s.time * 1.7) * 10;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(cw / 2, ch / 2 + heave);
    g.rotate(sway);
    g.scale(zoom, zoom);
    g.translate(-cam.x, -cam.y);
    // Extra margin so the rotated view never shows an unpainted corner
    drawOcean(g, cam, vw * 1.1, vh * 1.2, s.time);
    if (mapCanvas) g.drawImage(mapCanvas, -PAD.l, -PAD.t);

    if (s.showHatches) for (const h of map.hatches) drawHatch(g, h, s.time, h.id === s.inHatch);
    for (const t of s.tasks) drawStation(g, t, t.icon, s.time);
    for (const b of s.barrels) drawBarrel(g, b, s.time);

    const list = s.players.slice().sort((a, b) => a.y - b.y);
    for (const p of list) drawPirate(g, p, s.time);
    stepParticles(g, s.dt, true, ch);

    // Screen-space UI
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const meScreen = { x: cw / 2 + (s.me.x - cam.x) * zoom, y: ch / 2 + (s.me.y - cam.y) * zoom };
    if (s.inHatch) {
      // Dark tunnel view while hiding in a hatch
      drawDarkness(g, cw, ch, meScreen, 70 * zoom, 'rgba(10,6,2,.85)');
    } else if (s.fog) {
      drawDarkness(g, cw, ch, meScreen, 150 * zoom, 'rgba(200,210,220,.97)');
    }
    if (s.storm && !s.inHatch) drawStorm(g, cw, ch, s.time);
    if (s.showArrows) {
      const toScreen = (x, y) => ({ x: cw / 2 + (x - cam.x) * zoom, y: ch / 2 + (y - cam.y) * zoom });
      drawEdgeArrows(g, s.tasks, toScreen, cw, ch);
    }
    if (s.showJoystick) drawJoystick(g, MR.Input.joy, MR.Input.RADIUS, MR.Input.isTouch, ch);
    stepParticles(g, s.dt, false, ch);
  }

  // Whole-ship map (hatch panel and the 🗺️ map). Returns the view so taps can be mapped to the world.
  // o = { dpr, time, tasks: [{ x, y, icon, locked }],
  //       here?: hatch, dests?: [{ hatch, label }],          (inside a hatch)
  //       players?: [{ x, y, color, name, isMe }] }         (🗺️ map)
  function drawMinimap(canvas, o) {
    const dests = o.dests || [];
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return null;
    if (canvas.width !== Math.round(cw * o.dpr) || canvas.height !== Math.round(ch * o.dpr)) {
      canvas.width = Math.round(cw * o.dpr);
      canvas.height = Math.round(ch * o.dpr);
    }
    const g = canvas.getContext('2d');
    const B = { x: -90, y: -350, w: map.W + 180, h: map.H + 440 };
    const s = Math.min(cw / B.w, ch / B.h);
    const ox = (cw - B.w * s) / 2 - B.x * s, oy = (ch - B.h * s) / 2 - B.y * s;
    const k = 1 / s; // one screen pixel in world units

    g.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    g.fillStyle = '#1b5e7a';
    g.fillRect(0, 0, cw, ch);
    g.setTransform(o.dpr * s, 0, 0, o.dpr * s, o.dpr * ox, o.dpr * oy);
    if (mapCanvas) g.drawImage(mapCanvas, -PAD.l, -PAD.t);
    g.fillStyle = 'rgba(10,6,2,.35)';
    g.fillRect(B.x - 400, B.y - 400, B.w + 800, B.h + 800);

    // Your unfinished tasks
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const t of o.tasks) {
      g.fillStyle = t.locked ? 'rgba(90,90,90,.9)' : '#ffd23c';
      g.strokeStyle = t.locked ? '#333' : '#7a5300';
      g.lineWidth = 2 * k;
      g.beginPath(); g.arc(t.x, t.y, 13 * k, 0, Math.PI * 2); g.fill(); g.stroke();
      g.font = `${14 * k}px sans-serif`;
      g.fillText(t.locked ? '⚓' : t.icon, t.x, t.y + k);
    }

    // Routes from here to each destination
    const pulse = 0.5 + 0.5 * Math.sin(o.time * 5);
    g.save();
    g.strokeStyle = 'rgba(255,210,60,.8)';
    g.lineWidth = 3 * k;
    g.setLineDash([8 * k, 6 * k]);
    g.lineDashOffset = -o.time * 40 * k;
    for (const d of dests) {
      g.beginPath(); g.moveTo(o.here.x, o.here.y); g.lineTo(d.hatch.x, d.hatch.y); g.stroke();
    }
    g.restore();

    // Destination hatches (tappable)
    for (const d of dests) {
      const h = d.hatch;
      g.fillStyle = `rgba(255,210,60,${0.25 + pulse * 0.25})`;
      g.beginPath(); g.arc(h.x, h.y, (24 + pulse * 6) * k, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffd23c';
      g.strokeStyle = '#7a5300';
      g.lineWidth = 3 * k;
      g.fillRect(h.x - 11 * k, h.y - 11 * k, 22 * k, 22 * k);
      g.strokeRect(h.x - 11 * k, h.y - 11 * k, 22 * k, 22 * k);
      g.font = `600 ${13 * k}px Fredoka, sans-serif`;
      g.lineWidth = 4 * k;
      g.strokeStyle = 'rgba(0,0,0,.8)';
      g.strokeText(d.label, h.x, h.y - 28 * k);
      g.fillStyle = '#fff';
      g.fillText(d.label, h.x, h.y - 28 * k);
    }

    // Every pirate: colored dot + name (you get a pulsing ring)
    if (o.players) {
      const list = o.players.slice().sort((a, b) => a.isMe - b.isMe); // draw yourself on top
      for (const p of list) {
        if (p.isMe) {
          g.strokeStyle = '#fff';
          g.lineWidth = 3 * k;
          g.beginPath(); g.arc(p.x, p.y, (15 + pulse * 4) * k, 0, Math.PI * 2); g.stroke();
        }
        g.fillStyle = p.color;
        g.strokeStyle = 'rgba(0,0,0,.75)';
        g.lineWidth = 2.5 * k;
        g.beginPath(); g.arc(p.x, p.y, 9 * k, 0, Math.PI * 2); g.fill(); g.stroke();
        const label = p.isMe ? 'You' : p.name;
        g.font = `${p.isMe ? 700 : 600} ${13 * k}px Fredoka, sans-serif`;
        g.lineWidth = 4 * k;
        g.strokeStyle = 'rgba(0,0,0,.8)';
        g.strokeText(label, p.x, p.y - 22 * k);
        g.fillStyle = p.isMe ? '#ffe28a' : '#fff';
        g.fillText(label, p.x, p.y - 22 * k);
      }
    }

    if (!o.here) return { s, ox, oy };

    // You are here (inside a hatch)
    const h = o.here;
    g.strokeStyle = '#fff';
    g.lineWidth = 3 * k;
    g.beginPath(); g.arc(h.x, h.y, (14 + pulse * 4) * k, 0, Math.PI * 2); g.stroke();
    g.fillStyle = o.color || '#fff';
    g.beginPath(); g.arc(h.x, h.y, 8 * k, 0, Math.PI * 2); g.fill();
    g.font = `700 ${13 * k}px Fredoka, sans-serif`;
    g.lineWidth = 4 * k;
    g.strokeStyle = 'rgba(0,0,0,.8)';
    g.strokeText('You', h.x, h.y + 28 * k);
    g.fillStyle = '#fff';
    g.fillText('You', h.x, h.y + 28 * k);

    return { s, ox, oy };
  }

  return { buildMap, draw, drawMinimap, drawPirate, burst, puff, confetti, isReady: () => !!mapCanvas };
})();
