// All game sound, synthesized with WebAudio (no sound files).
MR.Sfx = (() => {
  let ac = null, master = null, noiseBuf = null;
  let ambient = null, gullTimer = 0;

  // Browsers only allow audio after the player touches the page.
  function ctx() {
    if (!MR.Settings.get('sound')) return null;
    try {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain();
        master.gain.value = 0.9;
        master.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    } catch {
      return null;
    }
  }
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => ctx(), { passive: true }));

  function noise() {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    return src;
  }

  function tone(freq, dur = 0.25, type = 'sine', vol = 0.18, endFreq = null) {
    const a = ctx();
    if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g).connect(master);
    o.start();
    o.stop(a.currentTime + dur);
  }

  // Filtered noise burst: footsteps, whooshes, splashes.
  function hiss(dur, freq, endFreq, vol, q = 1) {
    const a = ctx();
    if (!a) return;
    const src = noise(), f = a.createBiquadFilter(), g = a.createGain();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, a.currentTime);
    f.frequency.exponentialRampToValueAtTime(endFreq, a.currentTime + dur);
    g.gain.setValueAtTime(0.001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, a.currentTime + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    src.connect(f).connect(g).connect(master);
    src.start(a.currentTime, Math.random());
    src.stop(a.currentTime + dur);
  }

  // ---------- background: waves + seagulls ----------
  function startAmbient() {
    const a = ctx();
    if (!a || ambient) return;
    const src = noise();
    src.loop = true;
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = a.createGain();
    g.gain.value = 0.05;
    // Slow swell, like waves rolling in
    const lfo = a.createOscillator(), lfoGain = a.createGain();
    lfo.frequency.value = 0.13;
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(master);
    src.start();
    lfo.start();
    ambient = { src, lfo };
    scheduleGull();
  }

  function scheduleGull() {
    clearTimeout(gullTimer);
    gullTimer = setTimeout(() => {
      if (!ambient) return;
      tone(1700, 0.22, 'triangle', 0.025, 1150);
      setTimeout(() => tone(1600, 0.25, 'triangle', 0.02, 1050), 260);
      scheduleGull();
    }, 7000 + Math.random() * 12000);
  }

  function stopAmbient() {
    clearTimeout(gullTimer);
    if (!ambient) return;
    try { ambient.src.stop(); ambient.lfo.stop(); } catch { /* already stopped */ }
    ambient = null;
  }

  MR.Settings.onChange((k, v) => {
    if (k !== 'sound') return;
    if (!v) {
      stopAmbient();
      if (ac) ac.suspend();
    } else if (ac) {
      ac.resume();
    }
  });

  return {
    tone,
    startAmbient,
    stopAmbient,
    good: () => { tone(660, 0.12); setTimeout(() => tone(990, 0.2), 90); },
    bad: () => tone(140, 0.3, 'square', 0.12),
    click: () => tone(520, 0.06, 'triangle', 0.1),
    // Creaky wooden footstep
    step: () => { hiss(0.08, 300 + Math.random() * 120, 160, 0.09, 2); },
    // Grabbing a barrel
    whoosh: () => hiss(0.35, 500, 2400, 0.12, 0.8),
    // Hatch lid creak
    creak: () => tone(95 + Math.random() * 20, 0.35, 'sawtooth', 0.05, 70),
    splash: () => hiss(0.6, 1800, 300, 0.15, 0.6),
    // 💨 Wind in the Sails
    gust: () => hiss(0.9, 300, 1400, 0.16, 0.7),
    // 🔔 Ship's Alarm: clanging bell
    alarm: () => [0, 260, 520].forEach(d => setTimeout(() => {
      tone(880, 0.35, 'triangle', 0.14);
      tone(1320, 0.25, 'sine', 0.05);
    }, d)),
    // ⛈️ Storm: rolling thunder
    thunder: () => {
      hiss(1.6, 160, 50, 0.3, 0.5);
      setTimeout(() => hiss(1.2, 120, 40, 0.22, 0.5), 350);
    },
    // Ship events
    horn: () => { tone(196, 0.7, 'sawtooth', 0.1, 185); setTimeout(() => tone(147, 0.9, 'sawtooth', 0.1, 140), 350); },
    roar: () => { hiss(1.2, 140, 60, 0.3, 0.6); tone(70, 1.0, 'sawtooth', 0.12, 45); },
    drone: () => tone(110, 1.8, 'sine', 0.12, 70),
    // 🥅 Fishing Net: whoosh + thud
    net: () => { hiss(0.3, 1200, 400, 0.14, 1); setTimeout(() => tone(130, 0.2, 'sine', 0.2, 70), 260); },
    // 🍺 Rum Bottle
    hiccup: () => { tone(300, 0.12, 'triangle', 0.15, 700); setTimeout(() => tone(320, 0.12, 'triangle', 0.12, 760), 380); },
    // Emotes: a little sound for each
    emote: id => {
      const seq = {
        dance: [[523, 0], [659, 120], [784, 240], [659, 360], [880, 480]],
        wave: [[660, 0], [880, 110]],
        laugh: [[700, 0], [620, 110], [700, 220], [620, 330]],
        arr: [[220, 0], [196, 160]],
        angry: [[180, 0], [150, 140]],
        spin: [[400, 0], [600, 80], [800, 160], [1000, 240]],
        gg: [[523, 0], [784, 150]],
      }[id] || [];
      const type = id === 'arr' || id === 'angry' ? 'sawtooth' : 'triangle';
      seq.forEach(([f, d]) => setTimeout(() => tone(f, 0.14, type, 0.06), d));
    },
    beep: last => tone(last ? 880 : 520, last ? 0.4 : 0.15, 'square', 0.08),
    fanfare: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle'), i * 140)),
  };
})();
