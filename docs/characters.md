# Characters

How player and NPC figures are built, previewed and extended. This grows with
each milestone of the character model system; the sections below describe
what exists today.

## The preview page

`npm run dev`, then open <http://localhost:2006/dev/character/>. It is a
second Vite page (`dev/character/index.html`, code under `src/dev/character/`)
that draws one figure through the game's own post chain (HDR MSAA, ambient
occlusion, bloom, ACES, grade) under a choice of lighting rigs.

Controls, left to right in the panel:

- **Body**: race, sex, height, skin, eyes, hair style and colour, the painted
  tunic and trouser colours, "Random look".
- **Equipment**: one dropdown per slot, outfit sets (cloth, leather, chain,
  plate at any metal tier), "Random outfit", "Strip".
- **Animation**: idle, a treadmill walk and run, and every layered action clip
  of the procedural animator; "Replay" restarts one-shots.
- **View**: turntable and its speed, full / torso / head framing, lighting
  presets (in-game sun, golden hour, overcast, moonlit, studio).
- **Style**: the four stylised-rendering features, each with an on/off toggle
  and a strength, plus "Plain PBR" and "Styled" to flip them all for A/B.

Every control is written to the query string, so a look can be linked to.
Useful keys: `race`, `sex` (`m`/`f`), `hair`, `skin` (hex), `set=plate:rune`,
one key per slot (`helmet=bronze_full_helm`), `anim`, `light`, `frame`,
`style=all|off|wrap,rim`, `turntable=0`, `ui=0` (hides the panel).

`npm run shot:character` boots a server, renders the looks listed in
`scripts/character-shot.mjs` headlessly and writes them to `scripts/shots/`.
The same script runs at the end of `npm test` as the lab's smoke test.

Orbit with the left mouse button, raise or lower the view with the right,
zoom with the wheel. `window.__characterLab` exposes the lab, its config and
`apply(partial)` for scripts.

## How a figure is drawn today

Two body templates exist; one is chosen when the page loads:

- **The pipeline's bodies** (`public/models/characters/<race>_<m|f>.glb`,
  written by `npm run build:characters`, see the pipeline below): the default
  in the preview page, and in the game behind `?chars=new`. Each carries the
  shared humanoid skeleton and one body at three levels of detail; a spec
  names its body (`body: bodyFor(race, sex)`) and the human man is the
  default.
- **The legacy template** (`public/models/human.{json,bin}` from
  `scripts/build-human.mjs`): the game's default until the new path is
  integrated; `?chars=legacy` shows it in the preview page.

Either way, `src/render/human.ts` reshapes the finest mesh per character on
the CPU (limb bulk, shoulders, waist, hips, jaw, head and limb scale), scales
it to height, and builds one `THREE.Bone` per template bone. The skin, face
and underlayer clothing are painted per look onto the body's UV atlas
(`humanSkin.ts`); hair is geometry measured against the skull (`hair.ts`);
worn gear is rigid props on joint sockets (`gear.ts`), hung by `outfit.ts`,
which the game's entity view and the lab both use.

The procedural animator (`characters.ts`) drives the game's sixteen joints
(hips, spine, neck, head and three per limb). On the shared skeleton each
joint drives the bone that carries it (`gameJoints` in the GLB extras: hips
to Hips, spine to Spine, shoulderL to LeftArm, and so on); every other bone
(Spine1, Spine2, the clavicles, the toes, the hair and cape chains) follows
an owner joint, so the reshape, the painters and the clips carry over
unchanged.

A race is a body from the pipeline (its sex, build and face baked in) plus
proportion knobs on top of `HERO_BUILD` and default colours
(`RACES` in `src/dev/character/config.ts`), and what the body cannot carry
(`src/render/raceGear.ts`): an orc's tusks, a dwarf's beard. Dark elves share
the elf body and differ only in skin, hair and eye colour.

The style pass (`src/render/characterStyle.ts`) patches the PBR materials
through `onBeforeCompile`: soft wrap diffuse on non-metals, a specular boost
through the metal mask, a coloured fresnel rim light biased toward the back
light, and an emissive glow on materials flagged `userData.enchant`. All
values are shared uniforms; nothing is cloned per character.

## The asset pipeline

`scripts/build-characters.mjs` is the source of truth for the character
bodies. It downloads MakeHuman's CC0 base mesh, morph targets, default
skeleton and painted skin weights (cached under `scripts/.cache/`) and writes
one GLB per body in `public/models/characters/`:

1. layers the body's targets on the base mesh (`BODIES` in the script: a sex
   is the three ethnic young-adult targets blended equally plus MakeHuman's
   "ideal proportions"; races add build targets such as max muscle or min
   height, and face targets such as pointed ears or a heavy jaw) and keeps
   the `body` group (no helpers, joint cubes or teeth). The joint cubes move
   with the targets, so the skeleton follows the shape;
2. folds MakeHuman's 163 bones into the shared skeleton: 22 body bones with
   the standard humanoid names (Hips, Spine, Spine1, Spine2, Neck, Head,
   Left/RightShoulder, Arm, ForeArm, Hand, UpLeg, Leg, Foot, ToeBase) plus
   Hair1 to Hair3 and Cape1 to Cape3, short chains for sway;
3. bakes a canonical standing pose, grounds the model and converts it to
   metres;
4. computes smooth normals, splits vertices along UV seams and measures the
   landmarks and radii the renderer needs (eyes, nose, mouth, chin, ears,
   brows, skull, torso profile, feet, hands);
5. decimates the body with meshoptimizer into three LODs, each region to its
   own budget (`LOD_TARGETS`): the head and the hands keep their detail, the
   rest of the body is decimated hard. The regions are simplified separately
   with their borders locked, so they still meet exactly.

| LOD | triangles | head | hands | body |
| --- | --- | --- | --- | --- |
| 0 | 7000 | 3400 | 600 | 3000 |
| 1 | 2500 | 1000 | 200 | 1300 |
| 2 | about 900 | 300 | about 150 | 440 |

The GLB is plain glTF 2.0 (`scripts/gltf.mjs` writes it, `src/render/glb.ts`
reads it): joint nodes under `Hips`, one skin, and the `Body`, `Body_LOD1`
and `Body_LOD2` meshes. The measurements, the bone list with parents and rest
positions, the joint-to-bone map and the owner joint of every bone live in
`asset.extras`, so any glTF tool can open the file and the renderer needs no
scene-graph walk.

### Adding a race

1. Add a body per sex to `BODIES` in `scripts/build-characters.mjs`: start
   from `sexed('male')` / `sexed('female')` and layer targets from
   MakeHuman's `data/targets` tree (the script fetches them by name; the
   GitHub listing of a group such as `nose` or `torso` shows what exists).
   Run `npm run build:characters <id>` and read the printed measurements.
2. Add the id to `BodyId` and `BODY_IDS` in `src/render/human.ts` and teach
   `bodyFor` which race uses it.
3. Add the race to `Race` (same file), its label, proportion knobs, heights
   and colours to `RACES` in `src/dev/character/config.ts`, and anything the
   body cannot carry (tusks, a beard) to `raceExtras` in
   `src/render/raceGear.ts`.
4. Add a look to `scripts/character-shot.mjs` so the lab's smoke test
   renders it, and check it under each lighting preset.

## Where Blender would slot in

The asset build is a Node script (the source of truth). A Blender `bpy`
script could sit beside `scripts/build-characters.mjs` to sculpt race
variants and export them as glTF, which the Node build would then read like
any other input. None is checked in: there is no Blender on the build machine
and no unverified code goes in the repo.
