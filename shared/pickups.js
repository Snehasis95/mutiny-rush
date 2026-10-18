// Mystery-barrel pickups. Shared by the server and the browser.
(function (factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else {
    window.MR = window.MR || {};
    window.MR.Shared = window.MR.Shared || {};
    window.MR.Shared.pickups = mod;
  }
})(function () {
  // target: 'player' = pick a rival, 'self' = yourself, 'all' = every rival, 'passive' = works while held
  const items = [
    { id: 'anchor', name: 'Anchor',         icon: '⚓', target: 'player',  desc: "Chains one of a rival's tasks for 15s" },
    { id: 'slime',  name: 'Kraken Slime',   icon: '🐙', target: 'player',  desc: 'A rival moves at half speed for 8s' },
    { id: 'parrot', name: 'Parrot',         icon: '🦜', target: 'player',  desc: "Scrambles a rival's next mini-game" },
    { id: 'key',    name: "Smuggler's Key", icon: '🗝️', target: 'passive', desc: 'Use hatches for 30s or 3 trips' },
    { id: 'fog',    name: 'Fog',            icon: '🌫️', target: 'all',     desc: 'Every rival can barely see for 10s' },
    { id: 'coin',   name: 'Lucky Coin',     icon: '🛡️', target: 'self',    desc: 'Blocks the next sabotage against you' },
    { id: 'wave',   name: 'Big Wave',       icon: '🌊', target: 'player',  desc: "Washes away one of a rival's finished tasks" },
  ];

  const GRAB_DIST = 70;  // how close you must be to grab a barrel
  const HATCH_DIST = 60; // how close you must be to enter a hatch

  return { items, GRAB_DIST, HATCH_DIST };
});
