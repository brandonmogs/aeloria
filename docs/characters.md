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

One skinned body (MakeHuman's CC0 base mesh, see
`public/models/ATTRIBUTION.md`) converted by `scripts/build-human.mjs` into
`public/models/human.{json,bin}`. `src/render/human.ts` reshapes it per
character on the CPU (limb bulk, shoulders, waist, hips, jaw, head and limb
scale), scales it to height and binds it to a 16-joint skeleton. The skin,
face and underlayer clothing are painted per look onto the body's UV atlas
(`humanSkin.ts`); hair is geometry measured against the skull (`hair.ts`);
worn gear is rigid props on joint sockets (`gear.ts`), hung by
`outfit.ts`, which the game's entity view and the lab both use.

Races and sexes are, for now, presets of those reshape knobs
(`src/dev/character/config.ts`); milestone 3 replaces them with base meshes
per race on the shared skeleton.

The style pass (`src/render/characterStyle.ts`) patches the PBR materials
through `onBeforeCompile`: soft wrap diffuse on non-metals, a specular boost
through the metal mask, a coloured fresnel rim light biased toward the back
light, and an emissive glow on materials flagged `userData.enchant`. All
values are shared uniforms; nothing is cloned per character.

## Where Blender would slot in

The asset build is a Node script (the source of truth). A Blender `bpy`
script could sit beside `scripts/build-human.mjs` to sculpt race variants and
export them as glTF, which the Node build would then read like any other
input. None is checked in: there is no Blender on the build machine and no
unverified code goes in the repo.
