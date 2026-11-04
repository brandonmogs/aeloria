import * as THREE from 'three';
import { Rig } from './characters';
import { Race } from './human';

/**
 * What a race wears that its base body does not carry: an orc's tusks.
 * Returned as the `extras` hook of a HumanoidSpec, so the lab and the game
 * dress a race the same way. (A dwarf man's beard is the character builder's
 * default face style, so the screen can trim it.)
 */
export function raceExtras(race: Race): ((rig: Rig) => void) | undefined {
  switch (race) {
    case 'orc':
      return (rig) => rig.sockets.head.add(tusks(rig));
    default:
      return undefined;
  }
}

let tuskMaterial: THREE.MeshStandardMaterial | null = null;

/** Two lower tusks rising past the upper lip from the corners of the mouth. */
function tusks(rig: Rig): THREE.Object3D {
  const group = new THREE.Group();
  const face = rig.dims.face;
  if (!face) return group;
  tuskMaterial ??= new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.45, metalness: 0 });
  const s = rig.dims.scale;
  const length = 0.032 * s;
  const geo = new THREE.ConeGeometry(0.0055 * s, length, 10);
  geo.translate(0, length / 2, 0); // the base at the origin, the tip up
  for (const side of [-1, 1]) {
    const tusk = new THREE.Mesh(geo, tuskMaterial);
    tusk.position.set(side * face.mouthHalf * 0.75, face.mouth.y - 0.012 * s, face.mouth.z - 0.006 * s);
    tusk.rotation.set(-0.25, 0, side * -0.3); // leaning forward and outward
    tusk.castShadow = true;
    group.add(tusk);
  }
  return group;
}
