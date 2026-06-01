# Aeloria

An Old School RuneScape–inspired game built on the two things that make OSRS
feel like OSRS — a **600ms game tick** and a **tile grid** — but rendered with
modern WebGL (Three.js) instead of a 2007 Java engine.

## Design pillars

- **0.6s deterministic tick.** All game logic (movement, and later combat,
  skilling, queued actions) resolves on a fixed 600ms tick. Rendering runs at
  full framerate and interpolates between ticks, so motion is smooth while the
  logic stays discrete and predictable.
- **Tile-based world.** Entities occupy integer tiles. Pathfinding, collision,
  and the diagonal corner-cutting rule all match OSRS conventions.
- **Better graphics.** HD 3D with soft shadows and the classic rotatable,
  angled RuneScape camera.
- **Server-ready by construction.** The simulation (`src/sim`) is pure and
  deterministic — no Three.js, no DOM, no wall-clock. It advances only via
  `world.tick(commands)`. The same code can run on an authoritative server
  later with no rewrite.

## Getting started

```bash
npm install
npm run dev      # starts Vite and opens the game
```

Other scripts: `npm run build` (typecheck + bundle), `npm run typecheck`.

**Controls** — left-click to walk · middle/right-drag or arrow keys to rotate
the camera · scroll to zoom.

## Architecture

```
src/
├── engine/   GameLoop (fixed 600ms accumulator) + tuning constants
├── sim/      Pure deterministic game state: World, TileMap, Pathfinder,
│             Entity, Player, Command. No rendering, no input, no time.
├── render/   Three.js: Renderer, OrbitCamera, TileGridView, EntityView.
│             Reads sim state every frame; never mutates it.
├── input/    Mouse → tile → Command. The future network boundary.
└── ui/       Debug HUD (temporary).
```

The flow each frame: input produces **Commands** → the GameLoop drains them into
`world.tick()` every 600ms → the render views read the new state and interpolate.
Keeping `sim/` free of everything else is the whole game's load-bearing decision.

## Roadmap

Vertical slice (done): tick engine, tile map, BFS pathfinding, click-to-move
with smooth interpolation, OSRS camera.

Next up: NPCs, a tick-based combat system, an inventory/equipment model, a skill
+ XP framework, a real map/content pipeline, then the authoritative server split.
