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
- **Real OSRS maths.** Where OSRS documents a formula, we use it verbatim:
  combat accuracy/max hits, the XP curve, run-energy drain, prayer drain
  resistance, skilling success interpolation, NPC aggression rules. Sources:
  the OSRS Wiki plus open-source server emulators (Lost City / 2004Scape,
  RSMod) for engine structure.
- **Better graphics.** HD 3D with soft shadows, water reflections, and the
  classic rotatable, angled RuneScape camera.
- **Server-ready by construction.** The simulation (`src/sim`) is pure and
  deterministic — no Three.js, no DOM, no wall-clock. It advances only via
  `world.tick(commands)`. The same code can run on an authoritative server
  later with no rewrite.

## What's in the game

- **Combat** — OSRS-accurate melee math (accuracy/max-hit formulas, +8
  effective levels, prayer multipliers), four attack styles per weapon with
  style-routed XP (accurate/aggressive/defensive/controlled), weapon attack
  speeds, auto-retaliate toggle, swing / flinch / death animations, hitsplats,
  and the full combat-level formula.
- **Skills** — twelve trainable skills on the authentic XP curve: melee combat
  plus Woodcutting, Mining, Fishing, Firemaking, Cooking, and Prayer.
- **Skilling loops** — chop trees (4-tick rolls, axe tiers), mine rocks
  (pickaxe-speed cadence), net wandering fishing spots for shrimps and
  anchovies, light fires with a tinderbox (the 65→513/256 curve; you step west,
  fires burn down to ashes), and cook on those fires with level-based burn
  chances that stop at 34, exactly like shrimp.
- **Prayer** — bury bones, seven classic prayers with the real drain-effect /
  drain-resistance formula, Protect from Melee with an overhead icon that
  hard-blocks NPC melee, and an altar in the castle to recharge at.
- **Items** — a config registry (OSRS obj-config style) with stackable coins,
  item values and weights, equip level requirements, and the scimitar ladder
  from bronze to rune.
- **Run energy** — the wiki's drain formula (weight-scaled) and regen rates;
  the orb un-toggles itself at 0%.
- **NPCs** — goblin camp, giant rats, and castle guards with wiki-adjacent
  stats; aggression follows the OSRS rules (only players ≤ 2× the NPC's combat
  level, ~10-minute tolerance), idle NPCs wander, and everything leashes home.
- **Loot & death** — drop tables with coin ranges and rare gear onto the death
  tile; items despawn after two minutes. Dying drops everything but your three
  most valuable items and respawns you at the castle approach.
- **Bank** — booths in the castle courtyard open the Bank of Aeloria:
  deposit-1/5/all, withdrawals, everything stored as stacks, and the screen
  closes when you walk off.
- **UI** — the OSRS interface strip: combat options, skills (with XP
  tooltips), inventory, equipment (bonuses + weight), and prayer tabs;
  right-click context menus with threat-tinted "(level-2)" labels; XP drops;
  a chatbox; HP/prayer/run orbs; minimap with click-to-walk; compass.
- **Sound** — every effect synthesized in WebAudio; no audio assets.

## Getting started

```bash
npm install
npm run dev      # starts Vite and opens the game
```

Other scripts: `npm run build` (typecheck + bundle), `npm run typecheck`,
`npm test` (boots a dev server and drives the game in headless Edge through
fourteen end-to-end scenarios: combat, styles, prayer, loot, skilling loops,
banking, death, menus, HUD, sound).

**Controls** — left-click to act (attack / take / chop / mine / net / bank /
walk) · right-click for the context menu · middle-drag or arrow keys to rotate
· scroll to zoom · click the compass to face north · F3 for the debug overlay.

## Architecture

```
src/
├── engine/   GameLoop (fixed 600ms accumulator) + tuning constants
├── sim/      Pure deterministic game state: World, TileMap, Pathfinder,
│             Entity, Player, Npc, Inventory, Skills, combat math, the item
│             registry, prayers, resource nodes, fires, ground items,
│             commands, and the UI event queue.
├── render/   Three.js: Renderer (HDR + SSAO + bloom), OrbitCamera, views for
│             tiles/entities/scenery/water/ground items/fires/fishing spots.
│             Reads sim state every frame; never mutates it.
├── input/    Mouse → tile → Command. The future network boundary.
├── audio/    WebAudio-synthesized sound effects.
├── ui/       DOM overlays: tabbed side panel (combat/skills/inventory/
│             equipment/prayer), bank screen, minimap, orbs, context menu,
│             chatbox, XP drops, compass, debug HUD.
└── world/    Content: the starting map (castle, moat, forests, rocks,
              fishing spots, bank booths, altar).
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
attack styles and prayer, NPC AI (aggro rules/wander/leash), loot, death
rules, twelve skills (woodcutting, mining, fishing, firemaking, cooking,
prayer, melee), run energy, the item registry with stackables, banking,
context menus, the OSRS interface strip, synthesized audio, draw-call
optimization.

Next up: smithing (furnace + anvil for that copper), a general store, NPC
dialogue and a first quest, ranged + magic combat, more weapon classes
(longswords, maces, 2h), a bigger world with regions, and then the
authoritative server split.
