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
    { id: 'net',    name: 'Fishing Net',    icon: '🥅', target: 'player',  desc: "Traps a rival in place for 6s" },
    { id: 'wind',   name: 'Wind in the Sails', icon: '💨', target: 'self', desc: 'Double speed for 6s' },
    { id: 'alarm',  name: "Ship's Alarm",   icon: '🔔', target: 'all',     desc: 'Cancels every rival who is doing a task' },
    { id: 'storm',  name: 'Storm',          icon: '⛈️', target: 'all',     desc: 'Every rival gets blown around for 8s' },
    { id: 'rum',    name: 'Rum Bottle',     icon: '🍺', target: 'all',     desc: "Every rival's controls are reversed for 8s" },
  ];

  const GRAB_DIST = 70;  // how close you must be to grab a barrel
  const HATCH_DIST = 60; // how close you must be to enter a hatch

  // Movement effects, shared so the server's speed check matches what the phone does.
  const BOOST_MUL = 2;      // 💨 Wind in the Sails
  const SLOW_MUL = 0.5;     // 🐙 Kraken Slime
  const STORM_DRIFT = 0.45; // ⛈️ Storm: sideways push, as a fraction of normal speed

  // Combined speed multiplier and the extra distance a storm can add.
  function speedMul(slowed, boosted) {
    return (slowed ? SLOW_MUL : 1) * (boosted ? BOOST_MUL : 1);
  }

  return { items, GRAB_DIST, HATCH_DIST, BOOST_MUL, SLOW_MUL, STORM_DRIFT, speedMul };
});
