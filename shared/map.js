// Ship deck layout. Shared by the server (Node) and the browser.
(function (factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else {
    window.MR = window.MR || {};
    window.MR.Shared = window.MR.Shared || {};
    window.MR.Shared.map = mod;
  }
})(function () {
  const W = 2400;
  const H = 1400;
  const T = 24;      // wall thickness
  const DOOR = 150;  // doorway width

  const walls = [];

  // Horizontal wall at y from x1 to x2, with doorways centered at `doors`.
  function hWall(y, x1, x2, doors = []) {
    let start = x1;
    for (const d of doors.slice().sort((a, b) => a - b)) {
      const a = d - DOOR / 2;
      if (a > start) walls.push({ x: start, y: y - T / 2, w: a - start, h: T });
      start = d + DOOR / 2;
    }
    if (x2 > start) walls.push({ x: start, y: y - T / 2, w: x2 - start, h: T });
  }

  // Vertical wall at x from y1 to y2, with doorways centered at `doors`.
  function vWall(x, y1, y2, doors = []) {
    let start = y1;
    for (const d of doors.slice().sort((a, b) => a - b)) {
      const a = d - DOOR / 2;
      if (a > start) walls.push({ x: x - T / 2, y: start, w: T, h: a - start });
      start = d + DOOR / 2;
    }
    if (y2 > start) walls.push({ x: x - T / 2, y: start, w: T, h: y2 - start });
  }

  // Outer hull
  hWall(0, 0, W);
  hWall(H, 0, W);
  vWall(0, 0, H);
  vWall(W, 0, H);

  // Left and right room columns
  vWall(600, 0, 1000, [175, 525, 850]);
  vWall(1800, 0, 1000, [175, 525, 850]);
  hWall(350, 0, 600, [300]);
  hWall(700, 0, 600, [300]);
  hWall(350, 1800, W, [2100]);
  hWall(700, 1800, W, [2100]);

  // Lower deck row
  hWall(1000, 0, W, [400, 1050, 1550, 2100]);
  vWall(800, 1000, H, [1200]);
  vWall(1300, 1000, H, [1200]);

  const areas = [
    { id: 'cabin',   name: "Captain's Cabin", x: 0,    y: 0,    w: 600,  h: 350,  floor: '#9a6a44' },
    { id: 'maproom', name: 'Map Room',        x: 0,    y: 350,  w: 600,  h: 350,  floor: '#a57d50' },
    { id: 'galley',  name: 'Galley',          x: 0,    y: 700,  w: 600,  h: 300,  floor: '#b48a5a' },
    { id: 'deck',    name: 'Main Deck',       x: 600,  y: 0,    w: 1200, h: 1000, floor: '#c39462' },
    { id: 'nest',    name: "Crow's Nest",     x: 1800, y: 0,    w: 600,  h: 350,  floor: '#a98455' },
    { id: 'armory',  name: 'Armory',          x: 1800, y: 350,  w: 600,  h: 350,  floor: '#8f7357' },
    { id: 'cannon',  name: 'Cannon Deck',     x: 1800, y: 700,  w: 600,  h: 300,  floor: '#977050' },
    { id: 'cargo',   name: 'Cargo Hold',      x: 0,    y: 1000, w: 800,  h: 400,  floor: '#8b6a45' },
    { id: 'brig',    name: 'Brig',            x: 800,  y: 1000, w: 500,  h: 400,  floor: '#7d7468' },
    { id: 'vault',   name: 'Treasure Vault',  x: 1300, y: 1000, w: 1100, h: 400,  floor: '#a88a4a' },
  ];

  // Props are solid unless `solid: false`.
  const props = [
    // Main deck
    { type: 'mast',     x: 1160, y: 460,  w: 80,  h: 80 },
    { type: 'wheel',    x: 1170, y: 150,  w: 60,  h: 60 },
    { type: 'crate',    x: 1450, y: 40,   w: 70,  h: 70 },
    { type: 'crate',    x: 1520, y: 40,   w: 70,  h: 70 },
    { type: 'crate',    x: 1450, y: 110,  w: 70,  h: 70 },
    { type: 'barrel',   x: 700,  y: 860,  w: 56,  h: 56 },
    { type: 'barrel',   x: 760,  y: 900,  w: 56,  h: 56 },
    { type: 'crate',    x: 1500, y: 850,  w: 70,  h: 70 },
    // Captain's cabin
    { type: 'rug',      x: 90,   y: 70,   w: 420, h: 220, solid: false },
    { type: 'table',    x: 220,  y: 130,  w: 160, h: 90 },
    { type: 'chest',    x: 40,   y: 40,   w: 80,  h: 56 },
    // Map room
    { type: 'maptable', x: 200,  y: 470,  w: 200, h: 110 },
    { type: 'barrel',   x: 40,   y: 620,  w: 56,  h: 56 },
    // Galley
    { type: 'stove',    x: 30,   y: 730,  w: 140, h: 80 },
    { type: 'table',    x: 280,  y: 840,  w: 200, h: 70 },
    // Crow's nest
    { type: 'ladder',   x: 2300, y: 40,   w: 60,  h: 120 },
    { type: 'ropecoil', x: 2230, y: 220,  w: 90,  h: 90, solid: false },
    // Armory
    { type: 'rack',     x: 2330, y: 400,  w: 44,  h: 220 },
    { type: 'crate',    x: 1850, y: 600,  w: 70,  h: 70 },
    // Cannon deck
    { type: 'cannon',   x: 2250, y: 750,  w: 120, h: 56 },
    { type: 'cannon',   x: 2250, y: 900,  w: 120, h: 56 },
    { type: 'balls',    x: 1900, y: 900,  w: 70,  h: 70 },
    // Cargo hold
    { type: 'crate',    x: 30,   y: 1310, w: 70,  h: 70 },
    { type: 'crate',    x: 100,  y: 1310, w: 70,  h: 70 },
    { type: 'crate',    x: 30,   y: 1240, w: 70,  h: 70 },
    { type: 'barrel',   x: 680,  y: 1050, w: 56,  h: 56 },
    { type: 'barrel',   x: 650,  y: 1320, w: 56,  h: 56 },
    // Brig
    { type: 'cell',     x: 1120, y: 1280, w: 160, h: 105 },
    // Treasure vault
    { type: 'gold',     x: 1850, y: 1180, w: 140, h: 90, solid: false },
    { type: 'chest',    x: 1400, y: 1300, w: 100, h: 70 },
    { type: 'chest',    x: 2250, y: 1300, w: 100, h: 70 },
    // Bow (decoration beyond the railing)
    { type: 'ropecoil', x: 1050, y: -190, w: 90,  h: 90, solid: false },
    { type: 'ropecoil', x: 1260, y: -190, w: 90,  h: 90, solid: false },
  ];

  const spawn = { x: 1200, y: 500, r: 120 };

  // Every doorway and the two areas it joins (vertical = a gap in an up-down wall).
  const doors = [
    { x: 600,  y: 175,  vertical: true,  a: 'cabin',   b: 'deck' },
    { x: 600,  y: 525,  vertical: true,  a: 'maproom', b: 'deck' },
    { x: 600,  y: 850,  vertical: true,  a: 'galley',  b: 'deck' },
    { x: 1800, y: 175,  vertical: true,  a: 'nest',    b: 'deck' },
    { x: 1800, y: 525,  vertical: true,  a: 'armory',  b: 'deck' },
    { x: 1800, y: 850,  vertical: true,  a: 'cannon',  b: 'deck' },
    { x: 300,  y: 350,  vertical: false, a: 'cabin',   b: 'maproom' },
    { x: 300,  y: 700,  vertical: false, a: 'maproom', b: 'galley' },
    { x: 2100, y: 350,  vertical: false, a: 'nest',    b: 'armory' },
    { x: 2100, y: 700,  vertical: false, a: 'armory',  b: 'cannon' },
    { x: 400,  y: 1000, vertical: false, a: 'galley',  b: 'cargo' },
    { x: 1050, y: 1000, vertical: false, a: 'deck',    b: 'brig' },
    { x: 1550, y: 1000, vertical: false, a: 'deck',    b: 'vault' },
    { x: 2100, y: 1000, vertical: false, a: 'cannon',  b: 'vault' },
    { x: 800,  y: 1200, vertical: true,  a: 'cargo',   b: 'brig' },
    { x: 1300, y: 1200, vertical: true,  a: 'brig',    b: 'vault' },
  ];

  // Smuggler's hatches (vents). Hatches only connect to others in the same network.
  const hatches = [
    { id: 'h-cabin',   net: 'top',    x: 520,  y: 90 },
    { id: 'h-maproom', net: 'top',    x: 520,  y: 450 },
    { id: 'h-nest',    net: 'top',    x: 1880, y: 90 },
    { id: 'h-galley',  net: 'middle', x: 90,   y: 930 },
    { id: 'h-cargo',   net: 'middle', x: 300,  y: 1340 },
    { id: 'h-brig',    net: 'middle', x: 880,  y: 1340 },
    { id: 'h-cannon',  net: 'bottom', x: 1880, y: 760 },
    { id: 'h-armory',  net: 'bottom', x: 1880, y: 420 },
    { id: 'h-vault',   net: 'bottom', x: 2080, y: 1330 },
  ];

  // Where mystery barrels can wash up.
  const barrelSpots = [
    { x: 1000, y: 400 }, { x: 1400, y: 400 }, { x: 1200, y: 880 }, { x: 900, y: 650 },
    { x: 1650, y: 300 }, { x: 700, y: 150 },  { x: 300, y: 280 },  { x: 450, y: 520 },
    { x: 220, y: 950 },  { x: 2250, y: 290 }, { x: 2150, y: 600 }, { x: 2050, y: 880 },
    { x: 500, y: 1300 }, { x: 1050, y: 1250 }, { x: 1650, y: 1300 }, { x: 2200, y: 1120 },
  ];

  return { W, H, walls, areas, props, spawn, doors, hatches, barrelSpots };
});
