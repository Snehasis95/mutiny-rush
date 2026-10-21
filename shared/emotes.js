// Emotes: little animations a pirate can do (lobby and race). Shared by the server and the browser.
(function (factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else {
    window.MR = window.MR || {};
    window.MR.Shared = window.MR.Shared || {};
    window.MR.Shared.emotes = mod;
  }
})(function () {
  const list = [
    { id: 'dance', icon: '💃', name: 'Dance', ms: 2400 },
    { id: 'wave',  icon: '👋', name: 'Wave',  ms: 2000 },
    { id: 'laugh', icon: '😂', name: 'Laugh', ms: 2000 },
    { id: 'arr',   icon: '🏴‍☠️', name: 'Arrr!', ms: 1800 },
    { id: 'angry', icon: '😡', name: 'Angry', ms: 2000 },
    { id: 'spin',  icon: '🌀', name: 'Spin',  ms: 1400 },
    { id: 'gg',    icon: '🤝', name: 'GG',    ms: 2200 },
  ];
  const COOLDOWN_MS = 1500;
  const byId = Object.fromEntries(list.map(e => [e.id, e]));
  return { list, byId, COOLDOWN_MS };
});
