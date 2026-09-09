# Aeloria

An Old School RuneScape–style game built on the two things that make OSRS
feel like OSRS — a **600ms game tick** and a **tile grid** — with a modern WebGL
(Three.js) renderer in the spirit of RuneLite's 117 HD: physically based
materials, a real sky, soft shadows, reflective water, and articulated
characters that walk.

Every number that OSRS documents, Aeloria uses verbatim: the XP curve, the
combat formulas, prayer drain, run energy, shop prices, burn levels, item
bonuses. The sources are the [OSRS Wiki](https://oldschool.runescape.wiki)
(CC BY-NC-SA) and the open-source server emulators (Lost City / 2004Scape,
RSMod) for engine structure.

## Design pillars

- **0.6s deterministic tick.** All game logic (movement, combat, skilling,
  dialogue, shops) resolves on a fixed 600ms tick. Rendering runs at OSRS's
  50 fps and interpolates between ticks, so motion is smooth while the logic
  stays discrete and predictable.
- **Tile-based world.** Entities occupy integer tiles. Pathfinding,
  collision, and interactions all match OSRS conventions.
- **Real OSRS maths.** Where OSRS documents a formula, we use it: combat
  accuracy and max hits (with stab/slash/crush bonuses), the XP table
  (83 / 1,154 / 13,034,431), run-energy drain, prayer drain resistance,
  skilling success interpolation, NPC aggression rules, general-store pricing.
- **Wiki-sourced data.** Item stats and skill guides are *generated* from
  the wiki (`scripts/build-items.mjs`, `scripts/build-skill-guides.mjs`) rather
  than typed in — 174 items with exact bonuses, values, and weights, and 3,834
  skill-guide entries across all 23 skills.
- **Server-ready by construction.** The simulation (`src/sim`) is pure and
  deterministic — no Three.js, no DOM, no wall-clock. It advances only via
  `world.tick(commands)`, and everything the UI shows comes from an event
  queue. The same code can run on an authoritative server later.

## What's in the game

- **Skills** — all 23 OSRS skills on the real XP curve with a 200M cap. The
  stats tab is the OSRS one (current/base cells, total level, hover XP box),
  and clicking a skill opens its **skill guide**: every unlock by level,
  straight from the wiki's level-up tables.
- **Combat** — all three styles with OSRS maths. Melee with typed attack
  bonuses and four combat options per weapon category (dagger, sword,
  scimitar, longsword, mace, warhammer, battleaxe, 2h, axe, pickaxe). Ranged
  with a shortbow and arrows in the ammo slot (Accurate / Rapid / Longrange,
  arrows mostly recoverable). Magic with the standard spellbook: click a spell
  then a monster to cast, or autocast through a staff (the staff of air
  supplies air runes). Projectiles fly and land a tick or two later like the
  real thing. Style-routed XP, weapon speeds, two-handed rules,
  auto-retaliate, single-way combat, hitsplats, and the full combat-level
  formula. Monsters carry their wiki stats and bonuses.
- **Equipment** — bronze through rune weapon and armour sets, leather, the
  amulet slot, and an Equipment Stats sheet listing every bonus.
- **Skilling loops** — woodcutting (regular, oak, willow), mining (copper,
  tin, iron), fishing (net for shrimps/anchovies; rod and bait for
  sardine/herring), firemaking (65→513/256 curve; you step west), cooking on
  fires and on the castle range (lower burn levels, unlocked by a quest), and
  **smithing**: smelt at the furnace (iron's 50% failure included) and hammer
  bars into gear at the anvil through the OSRS-style smithing screen.
- **Quests** — a quest list in red / yellow / green under "Quest Points", a
  first-person journal with finished steps struck through, and the completion
  scroll. Four novice quests on the map: The Cook's Rat Problem, Goblin
  Trouble, A Woodsman's Wager, Fisherman's Favour.
- **NPC dialogue** — conversations in the chatbox, OSRS style (speaker name,
  "Click here to continue", option lists), scripted as small node graphs that
  branch on quest state.
- **Shop** — a general store priced by the wiki's rules (130% / 40% / 3% per
  unit, never below 10%), restocking a unit a minute; buy and sell 1/5/10.
- **Prayer** — the full 29-prayer book with wiki drain rates; melee stat
  prayers, Protect from Melee, Rapid Heal, and Protect Item do their jobs.
- **Magic** — the standard spellbook laid out with levels, runes, and max
  hits; the strike, bolt, blast, wave, and surge spells cast for real.
- **Bank, run energy, death** — booths in the courtyard; the wiki's energy
  drain and regen; three (four with Protect Item) most valuable items kept.
- **Map** — a rotating, player-centred minimap with NPC and item dots and
  click-to-walk, and a world map with place names and a key.
- **Interface** — the fourteen-tab stone side panel with F1–F7 shortcuts,
  parchment chatbox with channel buttons, right-click menus with level-tinted
  names, XP drops, orbs, compass.
- **Sound** — every effect and the music synthesized in WebAudio; no audio
  assets.

## Graphics

The renderer is built the way RuneLite's 117 HD builds its, then pushed
toward realism:

- **Light and sky** — a physically based atmospheric sky whose sun is
  prefiltered into an environment map, so every surface is lit by the sky it
  stands under; a warm directional sun with a 4096-texel shadow map that
  follows the camera and snaps to texels; a pool of dynamic point lights for
  fires, the furnace and spells; distance fog into the horizon haze.
- **Frame** — an MSAA half-float HDR buffer through ambient occlusion (GTAO),
  bloom on the sun, flames and spells, ACES tone mapping and a colour grade.
  Still capped at OSRS's 50 fps.
- **Ground** — a half-tile heightfield whose shader splat-blends grass, dirt
  and flagstone with per-layer normal and roughness maps and height-aware
  edges, so roads fray into the grass through the blades.
- **Surfaces** — CC0 photographic PBR scans from Poly Haven (colour, normal,
  roughness, occlusion) for ground, bark, boulders, walls, planks and slates,
  under `public/textures` with attribution; procedural canvas textures stand
  in for anything that fails to load.
- **Trees and water** — branching textured trunks under alpha-tested
  leaf-cluster cards whose lighting normals radiate from the canopy centre and
  which sway in a vertex-shader breeze; a moat that mirrors the scene from a
  planar reflection, rippled by scrolling normal maps, with Fresnel, a sun
  glint and foam along a noisy shoreline.
- **Characters** — articulated rigs with realistic proportions (two-segment
  limbs, hands, feet, faces, hair) and pose-based animation: a
  distance-phased walk and run so feet plant instead of sliding, eased
  turning, weapon-specific attacks, chopping, mining, fishing, smithing,
  fire-lighting, flinches and deaths, with equipment sized to each rig.
- **Fires** — noise-eroded flame cards, drifting embers, smoke, and a
  flickering light on everything nearby.

## Getting started

```bash
npm install
npm run dev      # starts Vite on http://localhost:2006 and opens the game
```

Other scripts: `npm run build` (typecheck + bundle), `npm run typecheck`,
`npm test` (boots a dev server and drives the game in headless Edge through
nineteen end-to-end scenarios), `node scripts/build-items.mjs` and
`node scripts/build-skill-guides.mjs` (refresh the wiki-derived data).

**Controls** — left-click to act (attack / talk / take / chop / mine / net /
bank / walk) · right-click for the context menu · middle-drag or arrow keys
to rotate · scroll to zoom · click the compass to face north · F1–F7 switch
tabs · Esc closes windows · M toggles music · F12 shows the debug overlay.

## Architecture

```
src/
├── engine/   GameLoop (fixed 600ms accumulator, 50 fps render cap) + constants
├── sim/      Pure deterministic game state: World, TileMap, Pathfinder,
│             Entity, Player, Npc, Inventory, Skills, combat math, the item
│             registry (over wiki data), prayers, spells, smithing recipes,
│             resource nodes, fires, quests, dialogue, shops, commands, and the
│             UI event queue.
├── render/   Three.js: Renderer (sky, shadows, post chain, light pool),
│             textured Terrain, OrbitCamera, characters (rigs + animator) and
│             gear, scenery (trees, rocks, castle), reflective water, fires,
│             projectiles, ground items; procedural textures and the CC0 photo
│             texture loader. Reads sim state every frame; never mutates it.
├── input/    Mouse → tile → Command. The future network boundary.
├── audio/    WebAudio-synthesized sound effects and music.
├── ui/       DOM overlays: the interface strip and its tabs, skill guide,
│             quest journal, dialogue box, shop, bank, smithing, minimap,
│             world map, orbs, context menu, chatbox, XP drops, compass.
└── world/    Content: the starting map (castle, moat, woods, mines) and the
              NPC roster with their dialogue scripts.
```

The flow each frame: input produces **Commands** → the GameLoop drains them
into `world.tick()` every 600ms → the render views read the new state and
interpolate. The sim announces gameplay moments (XP, level-ups, hits, dialogue
nodes, quest completions) on an **event queue** the UI drains — the same seam
a server would push events through. Keeping `sim/` free of everything else is
the whole game's load-bearing decision.

## Roadmap

More of the map (a village outside the walls, a second mine), crafting and
fletching, utility and teleport spells, a bigger quest with a real villain,
saving progress, and then the authoritative server split.
