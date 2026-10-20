// Cosmetic looks a pirate can pick in the lobby. Shared by the server and the browser.
(function (factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else {
    window.MR = window.MR || {};
    window.MR.Shared = window.MR.Shared || {};
    window.MR.Shared.looks = mod;
  }
})(function () {
  const hats = [
    { id: 'tricorn', name: 'Tricorn' },
    { id: 'bandana', name: 'Bandana' },
    { id: 'captain', name: "Captain's hat" },
    { id: 'skull',   name: 'Skull bandana' },
    { id: 'straw',   name: 'Straw hat' },
    { id: 'beanie',  name: 'Beanie' },
  ];
  const eyes = [
    { id: 'patch',   name: 'Eyepatch' },
    { id: 'both',    name: 'Both eyes' },
    { id: 'monocle', name: 'Monocle' },
  ];
  const DEFAULT = { hat: 'tricorn', eyes: 'patch' };

  // Returns a valid look, filling in anything missing or unknown.
  function clean(look) {
    const l = look || {};
    return {
      hat: hats.some(h => h.id === l.hat) ? l.hat : DEFAULT.hat,
      eyes: eyes.some(e => e.id === l.eyes) ? l.eyes : DEFAULT.eyes,
    };
  }

  function random() {
    return { hat: hats[Math.floor(Math.random() * hats.length)].id, eyes: eyes[Math.floor(Math.random() * eyes.length)].id };
  }

  return { hats, eyes, DEFAULT, clean, random };
});
