// Task types and task stations on the ship. Shared by the server and the browser.
(function (factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else {
    window.MR = window.MR || {};
    window.MR.Shared = window.MR.Shared || {};
    window.MR.Shared.tasks = mod;
  }
})(function () {
  // minMs: the fastest a real player can finish; the server rejects anything quicker.
  const types = [
    { id: 'ropes',   name: 'Tie the Ropes',   icon: '🪢', minMs: 1200 },
    { id: 'chest',   name: 'Crack the Chest', icon: '🔐', minMs: 1200 },
    { id: 'cannon',  name: 'Load the Cannon', icon: '💣', minMs: 600 },
    { id: 'map',     name: 'Swipe the Map',   icon: '🗺️', minMs: 400 },
    { id: 'bells',   name: 'Ring the Bells',  icon: '🔔', minMs: 2500 },
    { id: 'compass', name: 'Fix the Compass', icon: '🧭', minMs: 900 },
    { id: 'grog',    name: 'Cook the Grog',   icon: '🍲', minMs: 1500 },
    { id: 'swab',    name: 'Swab the Deck',   icon: '🧽', minMs: 1200 },
    { id: 'anchor',  name: 'Raise the Anchor', icon: '⚓', minMs: 1200 },
    { id: 'patch',   name: 'Patch the Hull',  icon: '🔨', minMs: 1500 },
  ];

  // The Captain picks how many tasks each player gets; that many types are drawn at random.
  const MIN_TASKS = 3;
  const MAX_TASKS = types.length;
  const DEFAULT_TASKS = 6;

  const stations = [
    { id: 'ropes-1',   type: 'ropes',   x: 860,  y: 300 },
    { id: 'ropes-2',   type: 'ropes',   x: 1560, y: 700 },
    { id: 'ropes-3',   type: 'ropes',   x: 2050, y: 250 },
    { id: 'ropes-4',   type: 'ropes',   x: 400,  y: 1150 },

    { id: 'chest-1',   type: 'chest',   x: 1450, y: 1250 },
    { id: 'chest-2',   type: 'chest',   x: 80,   y: 150 },
    { id: 'chest-3',   type: 'chest',   x: 2300, y: 1250 },
    { id: 'chest-4',   type: 'chest',   x: 950,  y: 1100 },

    { id: 'cannon-1',  type: 'cannon',  x: 2180, y: 778 },
    { id: 'cannon-2',  type: 'cannon',  x: 2180, y: 928 },
    { id: 'cannon-3',  type: 'cannon',  x: 2250, y: 500 },
    { id: 'cannon-4',  type: 'cannon',  x: 1990, y: 630 },

    { id: 'map-1',     type: 'map',     x: 300,  y: 630 },
    { id: 'map-2',     type: 'map',     x: 300,  y: 420 },
    { id: 'map-3',     type: 'map',     x: 470,  y: 270 },
    { id: 'map-4',     type: 'map',     x: 1300, y: 180 },

    { id: 'bells-1',   type: 'bells',   x: 1200, y: 700 },
    { id: 'bells-2',   type: 'bells',   x: 420,  y: 760 },
    { id: 'bells-3',   type: 'bells',   x: 700,  y: 500 },
    { id: 'bells-4',   type: 'bells',   x: 1800, y: 1100 },

    { id: 'compass-1', type: 'compass', x: 100,  y: 480 },
    { id: 'compass-2', type: 'compass', x: 2150, y: 100 },
    { id: 'compass-3', type: 'compass', x: 1050, y: 150 },
    { id: 'compass-4', type: 'compass', x: 650,  y: 1200 },

    { id: 'grog-1',    type: 'grog',    x: 220,  y: 820 },  // Galley
    { id: 'grog-2',    type: 'grog',    x: 60,   y: 1190 }, // Cargo Hold
    { id: 'grog-3',    type: 'grog',    x: 850,  y: 860 },  // Main Deck
    { id: 'grog-4',    type: 'grog',    x: 310,  y: 60 },   // Captain's Cabin

    { id: 'swab-1',    type: 'swab',    x: 1390, y: 860 },  // Main Deck
    { id: 'swab-2',    type: 'swab',    x: 520,  y: 940 },  // Galley
    { id: 'swab-3',    type: 'swab',    x: 1890, y: 280 },  // Crow's Nest
    { id: 'swab-4',    type: 'swab',    x: 1860, y: 1340 }, // Treasure Vault

    { id: 'anchor-1',  type: 'anchor',  x: 1640, y: 60 },   // Main Deck
    { id: 'anchor-2',  type: 'anchor',  x: 2340, y: 210 },  // Crow's Nest
    { id: 'anchor-3',  type: 'anchor',  x: 2000, y: 780 },  // Cannon Deck
    { id: 'anchor-4',  type: 'anchor',  x: 530,  y: 640 },  // Map Room

    { id: 'patch-1',   type: 'patch',   x: 220,  y: 1100 }, // Cargo Hold
    { id: 'patch-2',   type: 'patch',   x: 1210, y: 1060 }, // Brig
    { id: 'patch-3',   type: 'patch',   x: 2010, y: 1160 }, // Treasure Vault
    { id: 'patch-4',   type: 'patch',   x: 2080, y: 490 },  // Armory
  ];

  const USE_DIST = 90; // how close you must stand to use a station

  // 🤝 Co-op tasks (Teams only): two crewmates have to do them together.
  // The Two-Key Vault has two locks in different rooms (x2, y2 is the second one).
  const coopTypes = [
    { id: 'sail',  name: 'Hoist the Mainsail', place: 'the Mainsail',   icon: '⛵', coop: true, how: 'Both hold your crank' },
    { id: 'pump',  name: 'Pump the Bilge',     place: 'the Bilge Pump', icon: '🪣', coop: true, how: 'Take turns pumping' },
    { id: 'vault', name: 'Two-Key Vault',      place: 'the Vault',      icon: '🏦', coop: true, how: 'Turn both keys in time' },
  ];
  const coopStations = [
    { type: 'sail',  x: 1200, y: 610 },                        // Main Deck, at the mast
    { type: 'pump',  x: 420,  y: 1280 },                       // Cargo Hold
    { type: 'vault', x: 1650, y: 1130, x2: 140, y2: 290 },     // Treasure Vault + Captain's Cabin
  ];
  const COOP = {
    SAIL_UP_MS: 4000,     // both holding: empty to full
    SAIL_DOWN_MS: 6000,   // nobody (or one) holding: full to empty
    PUMPS: 10,            // pumps in total, taking turns
    JAM_MS: 1000,         // pumping out of turn
    VAULT_MS: 6000,       // the second key must turn this soon after the first
    SOLO_VAULT_MS: 25000, // a crew of one runs between the locks
    REMIND_MS: 20000,     // unanswered call: buzz the crew once more
    COOLDOWN_MS: 5000,    // after cancelling a call
  };

  return { types, stations, USE_DIST, MIN_TASKS, MAX_TASKS, DEFAULT_TASKS, coopTypes, coopStations, COOP };
});
