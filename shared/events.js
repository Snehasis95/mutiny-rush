// Random ship events. Shared by the server and the browser.
(function (factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else {
    window.MR = window.MR || {};
    window.MR.Shared = window.MR.Shared || {};
    window.MR.Shared.events = mod;
  }
})(function () {
  const types = [
    { id: 'kraken',  name: 'Kraken Attack', icon: '🐙', warning: 'KRAKEN ATTACK!', ms: 12000, desc: 'Octopuses are blocking doorways!' },
    { id: 'wave',    name: 'Rogue Wave',    icon: '🌊', warning: 'ROGUE WAVE!',    ms: 4000,  desc: 'Hold on, the wave is pushing you!' },
    { id: 'eclipse', name: 'Eclipse',       icon: '🌑', warning: 'ECLIPSE!',       ms: 10000, desc: 'The sky went dark!' },
  ];

  const WARNING_MS = 3000;          // banner before an event hits
  const FIRST_MS = 30000;           // first event this long after the race starts
  const GAP_MS = [35000, 50000];    // quiet time between events
  const KRAKEN_DOORS = 3;           // doorways blocked by tentacles
  const WAVE_PUSH = 0.8;            // wave push, as a fraction of normal walking speed

  // A tentacle plugging a doorway (a little wider than the gap so nobody squeezes past).
  function tentacleRect(door) {
    return door.vertical
      ? { x: door.x - 28, y: door.y - 80, w: 56, h: 160 }
      : { x: door.x - 80, y: door.y - 28, w: 160, h: 56 };
  }

  return { types, WARNING_MS, FIRST_MS, GAP_MS, KRAKEN_DOORS, WAVE_PUSH, tentacleRect };
});
