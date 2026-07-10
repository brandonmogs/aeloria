# Aeloria

An Old School RuneScape–inspired game built on the two things that make OSRS
feel like OSRS — a **600ms game tick** and a **tile grid** — but rendered with
modern WebGL (Three.js) instead of a 2007 Java engine.

## Design pillars

- **0.6s deterministic tick.** All game logic (movement, combat, skilling,
  queued actions) resolves on a fixed 600ms tick. Rendering runs at full
  framerate and interpolates between ticks, so motion is smooth while the
  logic stays discrete and predictable.
- **Tile-based world.** Entities occupy integer tiles. Pathfinding, collision,
  and interactions all match OSRS conventions.
- **Better graphics.** HD 3D with soft shadows, water reflections, and the
  classic rotatable, angled RuneScape camera.
- **Server-ready by construction.** The simulation (`src/sim`) is pure and
  deterministic — no Three.js, no DOM, no wall-clock. It advances only via
  `world.tick(commands)`. The same code can run on an authoritative server
  later with no rewrite.

## What's in the game

- **Combat** — OSRS-accurate melee math (accuracy/max-hit formulas), swing /
  flinch / death animations, hitsplats, auto-retaliate, and combat XP.
- **NPCs** — goblin camp, giant rats, and castle guards; aggressive NPCs jump
  players, idle NPCs wander their patch, and everything leashes back home.
- **Loot** — drop tables roll onto the death tile; click to walk over and pick
  up. Items despawn after two minutes.
- **Skilling** — chop trees and mine rocks. Nodes deplete into stumps/rubble
  and regrow on a timer. Authentic XP curve, level-up fanfare.
- **UI** — inventory/equipment/skills panel, right-click context menus
  ("Attack Goblin (level-2)"), XP drops, message log, HP orb, run toggle,
  minimap with click-to-walk, compass.
- **Sound** — every effect synthesized in WebAudio; no audio assets.

## Getting started

```bash
npm install
npm run dev      # starts Vite and opens the game
```

Other scripts: `npm run build` (typecheck + bundle), `npm run typecheck`,
`npm test` (boots a dev server and drives the game in headless Edge through
nine end-to-end scenarios: combat, loot, skilling, menus, HUD, sound).

**Controls** — left-click to act (attack / take / chop / mine / walk) ·
right-click for the context menu · middle-drag or arrow keys to rotate ·
scroll to zoom · click the compass to face north · F3 for the debug overlay.

## Architecture

```
src/
├── engine/   GameLoop (fixed 600ms accumulator) + tuning constants
├── sim/      Pure deterministic game state: World, TileMap, Pathfinder,
│             Entity, Player, Npc, Inventory, Skills, combat math, resource
│             nodes, ground items, commands, and the UI event queue.
├── render/   Three.js: Renderer (HDR + SSAO + bloom), OrbitCamera, views for
│             tiles/entities/scenery/water/ground items. Reads sim state every
│             frame; never mutates it.
├── input/    Mouse → tile → Command. The future network boundary.
├── audio/    WebAudio-synthesized sound effects.
├── ui/       DOM overlays: inventory panel, minimap, orbs, context menu,
│             message log, XP drops, compass, debug HUD.
└── world/    Content: the starting map (castle, moat, forests, rocks).
```

The flow each frame: input produces **Commands** → the GameLoop drains them
into `world.tick()` every 600ms → the render views read the new state and
interpolate. The sim announces gameplay moments (XP, level-ups, hits, kills)
on an **event queue** the UI drains — the same seam a server would push events
through. Keeping `sim/` free of everything else is the whole game's
load-bearing decision.

Rendering is draw-call frugal: the castle is baked into one mesh per material
and all trees/rocks are instanced, so the scene survives being drawn four
times per frame (shadow map, water reflection, SSAO, main pass).

## Roadmap

Done: tick engine, pathfinding, click-to-move, OSRS camera, melee combat with
animations and XP, NPC AI (aggro/wander/leash), loot, woodcutting/mining,
context menus, game HUD, synthesized audio, draw-call optimization.

Next up: item actions (bury bones, eat food), a bank, more weapon tiers and
attack styles, quests/objectives, a bigger world with regions, and then the
authoritative server split.
