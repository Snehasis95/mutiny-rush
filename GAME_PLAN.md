# 🏴‍☠️ Mutiny Rush — Game Plan

*(Working title)*

## 1. Overview
| | |
|---|---|
| **Genre** | Competitive top-down 2D task race with sabotage |
| **Platform** | Mobile web game (PWA), landscape only. Android + iPhone via browser, installable to home screen. Store app later via Capacitor. |
| **Players** | 2–6 per room |
| **Match length** | ~3–5 minutes |
| **Win condition** | First player to complete all 6 of their tasks wins |
| **Theme** | Pirate ship |

## 2. Match Flow
1. **Lobby** — Create Room → get a 4-letter code / share link (e.g. WhatsApp). Others join by code or link. Each player picks a name and color. Host taps **Start**.
2. **Countdown** — 3, 2, 1… everyone spawns at the main mast.
3. **Race** — run to tasks, complete mini-games, grab barrels, sabotage rivals.
4. **Win** — when someone finishes their last task the game freezes: "🏴‍☠️ *Name* is the new Captain!" with gold-coin confetti and a ranking by tasks completed.
5. **Rematch** — back to the lobby in the same room.
6. **Reconnect** — a player who drops (call, bad signal) can rejoin the same match.

## 3. Map — One Big Deck
A single flat ship deck, seen from above, surrounded by ocean.

```
                         BOW (front)
   ┌──────────────┬──────────────────────┬──────────────┐
   │  Captain's   │                      │   Crow's     │
   │   Cabin      │                      │   Nest       │
   ├──────────────┤      MAIN DECK       ├──────────────┤
   │   Map Room   │   (spawn — mast)     │   Armory     │
   ├──────────────┤                      ├──────────────┤
   │   Galley     │                      │ Cannon Deck  │
   ├──────────────┼──────────┬───────────┼──────────────┤
   │  Cargo Hold  │   Brig   │  Treasure Vault          │
   └──────────────┴──────────┴──────────────────────────┘
                         STERN (back)
```
- **10 areas**, each with its own floor tone and props (barrels, crates, ropes, lanterns, cannons, maps) so players can navigate without a minimap.
- **~20 task stations** spread across the areas.
- **Barrel spawn points** in open deck space and junctions between areas.
- **8–9 smuggler's hatches** (see §6).

## 4. Tasks
- Each player gets **6 tasks** — the **same 6 types for everyone**, at **different locations**.
- Locations are assigned so every player's total walking distance is roughly equal.
- Only the owner sees their own task markers (glowing yellow ring + bouncing "!").
- If a player is sabotaged mid-task, the mini-game closes and that task restarts.

| Task | Possible locations | Touch mini-game | Time |
|---|---|---|---|
| 🪢 Tie the Ropes | Main Deck, Crow's Nest | Drag rope ends to matching colored knots | ~6s |
| 🔐 Crack the Chest | Treasure Vault, Captain's Cabin | Memorize a 4-digit code, tap it on a big dial/number pad | ~5s |
| 💣 Load the Cannon | Cannon Deck, Armory | Hold to pour gunpowder, release in the green zone | ~4s |
| 🗺️ Swipe the Map | Map Room, Captain's Cabin | Swipe to unroll the map at the right speed | ~3s |
| 🔔 Ring the Bells | Main Deck, Galley | Repeat a 4-bell pattern (Simon) | ~6s |
| 🧭 Fix the Compass | Map Room, Crow's Nest | Tap when the needle points north, ×3 | ~6s |

Each mini-game opens as a full-screen panel with large touch targets and a ✕ to close.

## 5. Pickups — 🛢️ Mystery Barrels
- Barrels spawn at random spawn points **every ~10s**, **max 4** on the map.
- Contents are hidden until grabbed.
- A player can hold **only 1 pickup at a time** (one slot — Smuggler's Key included).
- Trailing players get better odds of rare pickups (catch-up).

| Pickup | Effect | Target | Rarity |
|---|---|---|---|
| ⚓ Anchor | Chains one random unfinished task of the target for 15s | Pick a player | Common |
| 🐙 Kraken Slime | Target moves at half speed for 8s | Pick a player | Common |
| 🦜 Parrot | Target's next mini-game is scrambled/harder | Pick a player | Common |
| 🗝️ Smuggler's Key | Use hatches for 30s or 3 trips | Self | Common |
| 🌫️ Fog | Everyone else sees only a small circle for 10s | All others | Uncommon |
| 🛡️ Lucky Coin | Blocks the next sabotage against you | Self | Uncommon |
| 🌊 Big Wave | Resets one of the target's completed tasks | Pick a player | Rare |

**Fairness rules**
- After being sabotaged, a player is **immune for 10s**.
- **Big Wave** can't target a player with only 1 task left.
- Targeted pickups open the Players list as a **target picker** — tap a name.

## 6. Smuggler's Hatches (Vents)
Hidden trapdoors that only work for a player holding the **🗝️ Smuggler's Key**.

**Networks** (hatches only connect within their group):
```
Captain's Cabin ⇄ Map Room ⇄ Crow's Nest
Galley ⇄ Cargo Hold ⇄ Brig
Cannon Deck ⇄ Armory ⇄ Treasure Vault
```

**Usage**
1. Holding the key → hatches glow gold (only for you).
2. Walk onto one, tap **USE** → drop in.
3. Arrows show connected hatches → tap one to travel (~1s tunnel animation).
4. Tap **EXIT** to pop out.

**Rules**
| Rule | Value |
|---|---|
| Key duration | 30s or 3 trips, whichever comes first |
| Inside a hatch | Hidden, can't be sabotaged, can't do tasks |
| Max time inside | 5s, then auto-ejected |
| Exiting | Dust puff + creak sound, visible/audible to nearby players |
| Without key | Hatches look like normal planks |

## 7. Controls (Touch, Landscape)
```
┌──────────────────────────────────────────────────┐
│ [📋 Tasks 2/6]                       [🏆]   [⚙]  │
│                                                  │
│                    (game map)                    │
│                                                  │
│   ╭───╮                                  [ ⚓ ]  │
│  (  ●  )                               [  USE  ] │
│   ╰───╯                                          │
└──────────────────────────────────────────────────┘
```
| Control | Action |
|---|---|
| Virtual joystick (left half) | Appears where the thumb touches; drag to move |
| USE (right) | Lights up near a task / barrel / hatch; tap to interact |
| Pickup button | Shows held pickup; tap to use (key shows countdown ring + uses left) |
| 📋 Tasks | Toggle full task list |
| 🏆 Players | Open the Players panel |
| ⚙ Settings | Sound, vibration, ship sway on/off |

**Haptics:** short vibration on task complete, pickup grab, and being sabotaged (Android).

## 8. HUD & Players Panel
- **Top-left:** task counter (📋 2/6).
- **Edge arrows** pointing to your nearest unfinished tasks.
- **Notifications** slide in from the top for ~2s: "⚓ Rahul anchored your task!"
- **🏆 Players panel** (game keeps running behind it, updates live):
```
┌─────────── Players ───────────┐
│ 1. 🟢 Rahul   ▓▓▓▓░░  4/6     │
│ 2. 🔵 You     ▓▓▓░░░  3/6     │
│ 3. 🔴 Priya   ▓▓░░░░  2/6  ⚓ │
│ 4. 🟡 Aman    ▓░░░░░  1/6  🐙 │
│                          [ ✕ ]│
└───────────────────────────────┘
```
  - Sorted by progress, your row highlighted.
  - Status icons: ⚓ 🐙 🦜 🛡️ 🗝️.
  - Same list is used as the target picker.
  - *(Optional)* red badge on 🏆 when anyone reaches 5/6.

## 9. Graphics & Audio
**Style:** flat, colorful cartoon, drawn in code (Canvas) — no artist needed, light on phones. Can swap in sprites (e.g. Kenney.nl) later without changing logic.

**Characters — bean pirates**
- Round bean body in the player's color (8 colors), eyepatch, pirate hat / bandana, name tag.
- Waddle/bounce walk, happy jump on task complete.
- Effects: slime drips (slowed), golden bubble (shielded).
- Later: parrot on the shoulder for last match's winner, unlockable hats.

**World**
- Wooden plank deck, ropes, barrels, lanterns, ocean waves around the ship.
- Slight camera sway (toggle in settings).
- Fog pickup = dark screen with a light circle around you.

**UI**
- Parchment panels, wooden rounded buttons with 3D press effect.
- Fonts: **Pirata One** (titles), **Fredoka** (text).
- Juice: particles on task complete, screen shake when sabotaged, coin confetti on win.

**Audio** (free from Kenney.nl / freesound.org)
- Waves, seagulls, creaky footsteps, task "ding", barrel "whoosh", sabotage "buzz", "Yo-ho!" win fanfare.

## 10. Technical Architecture
- **Server — Node.js + Express + Socket.IO (authoritative):** rooms, positions, collisions, task assignment & completion, barrel spawns, pickups & effects, hatches, win detection. Prevents cheating.
- **Client — HTML5 Canvas + JavaScript:** touch input, rendering, HUD, mini-games (run locally, result reported to server).
- **Networking:** server ticks at 20/s, client interpolates for smooth movement; small messages for 4G.
- **Screens:** scales to any phone size, respects notches (safe areas), forces landscape ("Please rotate your phone").
- **PWA:** manifest + service worker for "Add to Home Screen" full-screen play.

**Folder structure**
```
amongus/
  server/
    index.js        – Express + Socket.IO entry
    Room.js         – lobby & match state
    gameLogic.js    – movement, tasks, pickups, hatches
    map.js          – walls, areas, stations, barrel spawns, hatches
  public/
    index.html
    manifest.json
    css/style.css
    js/
      main.js       – connection, game loop
      render.js     – map, players, effects
      hud.js        – HUD, players panel, notifications
      touch.js      – joystick & buttons
      minigames/    – ropes.js, chest.js, cannon.js, map.js, bells.js, compass.js
  package.json
  GAME_PLAN.md
```

**Testing:** run the server on the PC; phones on the same Wi-Fi open `http://<PC-IP>:3000`. Later deploy to Render/Railway (free) for play from anywhere.

## 11. Milestones
| # | Milestone | Result |
|---|---|---|
| **M1** ✅ | Lobby, room codes, ship deck map, joystick movement | Phone + PC see each other moving |
| **M2** ✅ | Tasks + all 6 mini-games + Players panel + win screen | Fully playable race |
| **M3** ✅ | Barrels, all pickups, target picker, immunity, hatches | Core game complete |
| **M4** ✅ | Polish, more sounds, settings (sway/sound/vibration), PWA install | Ready to show friends |
| **M5** | Deploy online + share links + reconnect | Friends join from anywhere |

## 12. Decisions Log
- Phone-first, landscape, mobile web (PWA).
- 2–6 players; top-down 2D.
- Same task types, different locations; 6 tasks each.
- Sabotage via pickups from mystery barrels; single pickup slot.
- Smuggler's Key (vents) shares the pickup slot.
- Players list behind a 🏆 button instead of always-on progress bars.
- Pirate ship theme; one big deck for v1 (multi-level later).
- No player pushing in v1.
- Name: **Mutiny Rush** (working title).
