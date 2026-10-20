// The lobby: one cosy room (the Captain's Quarters) with the ship's wheel in the middle.
// Players walk around here before the race. Shared by the server and the browser.
(function (factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else {
    window.MR = window.MR || {};
    window.MR.Shared = window.MR.Shared || {};
    window.MR.Shared.lobbyMap = mod;
  }
})(function () {
  const W = 1100;
  const H = 620;
  const T = 26; // wall thickness

  const walls = [
    { x: 0, y: 0, w: W, h: T },
    { x: 0, y: H - T, w: W, h: T },
    { x: 0, y: 0, w: T, h: H },
    { x: W - T, y: 0, w: T, h: H },
  ];

  // Props are solid unless `solid: false`. Furniture hugs the walls so the middle stays open.
  const props = [
    { type: 'rug',    x: W / 2 - 250, y: H / 2 - 170, w: 500, h: 340, solid: false },
    { type: 'helm',   x: W / 2 - 55,  y: H / 2 - 55,  w: 110, h: 110 },
    { type: 'barrel', x: 50,  y: 50,  w: 56, h: 56 },
    { type: 'barrel', x: 112, y: 50,  w: 56, h: 56 },
    { type: 'crate',  x: W - 126, y: 46, w: 76, h: 76 },
    { type: 'crate',  x: W - 200, y: 46, w: 66, h: 66 },
    { type: 'chest',  x: 48,  y: H - 112, w: 104, h: 62 },
    { type: 'barrel', x: W - 110, y: H - 110, w: 56, h: 56 },
    { type: 'balls',  x: W - 190, y: H - 104, w: 64, h: 54 },
  ];

  // New arrivals appear in a ring around the wheel.
  const spawn = { x: W / 2, y: H / 2, r: 170 };

  // Windows along the top wall (decoration)
  const windows = [W * 0.25, W * 0.5, W * 0.75];

  return { W, H, walls, props, spawn, windows, areas: [] };
});
