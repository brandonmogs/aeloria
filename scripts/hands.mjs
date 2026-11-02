// Relaxed hands for the bodies built from the MakeHuman base mesh, shared by
// the body build scripts. The base mesh holds its fingers straight and spread;
// before the finger bones fold into the hand bone, this curls them gently
// toward the palm and closes the spread, so every body is exported with the
// easy, half-closed hands of someone standing at rest or holding a grip.
import * as THREE from 'three';

/**
 * Flexion at the knuckle, middle and tip joints (radians), and how far each
 * finger turns toward the middle finger to close the spread. Finger 1 is the
 * thumb; the curl deepens toward the little finger, as a resting hand's does.
 */
export const FINGER_CURL = {
  1: { flex: [0.15, 0.25, 0.15], spread: 0.1 },
  2: { flex: [0.3, 0.45, 0.25], spread: 0.1 },
  3: { flex: [0.33, 0.5, 0.28], spread: 0 },
  4: { flex: [0.36, 0.55, 0.3], spread: 0.07 },
  5: { flex: [0.4, 0.6, 0.32], spread: 0.16 },
};

/**
 * Curl the fingers of `verts` (the base mesh's vertices as Vector3s, in any
 * unit, morph targets already applied) in place through the painted finger
 * weights of MakeHuman's default rig: `skel` is the parsed `.mhskel`, whose
 * joints name the helper-cube vertices each bone starts and ends at, and
 * `weights` the parsed `.mhw` file's `weights` map (bone -> [[vertex, w]]).
 * Returns how many vertices moved.
 */
export function relaxHands(verts, skel, weights) {
  const centroidOf = (ids) => {
    const c = new THREE.Vector3();
    for (const i of ids) c.add(verts[i]);
    return c.divideScalar(ids.length);
  };
  const head = (b) => centroidOf(skel.joints[skel.bones[b].head]);
  const tail = (b) => centroidOf(skel.joints[skel.bones[b].tail]);
  const rot = (axis, angle) => new THREE.Matrix4().makeRotationAxis(axis, angle);
  const about = (pivot, R) =>
    new THREE.Matrix4()
      .makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(R)
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  const transforms = new Map(); // finger bone -> Matrix4, rest space to relaxed
  for (const side of ['L', 'R']) {
    const f = (k, s) => `finger${k}-${s}.${side}`;
    // The palm's normal points out of the palm: the side the thumb's tip lies on.
    const dir3 = tail(f(3, 1)).sub(head(f(3, 1))).normalize();
    const across = head(f(2, 1)).sub(head(f(5, 1)));
    const n = new THREE.Vector3().crossVectors(dir3, across).normalize();
    if (tail(f(1, 3)).sub(head(f(3, 1))).dot(n) < 0) n.negate();
    const middle = head(f(3, 1));
    for (let k = 1; k <= 5; k++) {
      const { flex, spread } = FINGER_CURL[k];
      let M = new THREE.Matrix4();
      if (spread > 0) {
        // Close the spread: turn the whole finger about the palm normal toward the middle finger.
        const h = head(f(k, 1));
        const d = tail(f(k, 1)).sub(h);
        const toMiddle = middle.clone().sub(h);
        const sgn = Math.sign(new THREE.Vector3().crossVectors(d, toMiddle).dot(n)) || 1;
        M = about(h, rot(n, sgn * spread));
      }
      for (let s = 1; s <= 3; s++) {
        // Curl each joint about the axis across the finger, in the pose the joints above it left it in.
        const bone = f(k, s);
        const h = head(bone).applyMatrix4(M);
        const d = tail(bone).applyMatrix4(M).sub(h).normalize();
        const nn = n.clone().transformDirection(M);
        const axis = new THREE.Vector3().crossVectors(d, nn).normalize();
        M = about(h, rot(axis, flex[s - 1])).multiply(M);
        transforms.set(bone, M.clone());
      }
    }
  }
  // Linear-blend the finger flesh through its painted weights; the palm and everything else stays put.
  const moved = new Map(); // vertex index -> accumulated offset
  const tmp = new THREE.Vector3();
  for (const [bone, M] of transforms) {
    for (const [vi, w] of weights[bone] ?? []) {
      const v = verts[vi];
      if (!v) continue;
      tmp.copy(v).applyMatrix4(M).sub(v).multiplyScalar(w);
      const acc = moved.get(vi);
      if (acc) acc.add(tmp);
      else moved.set(vi, tmp.clone());
    }
  }
  for (const [vi, off] of moved) verts[vi].add(off);
  return moved.size;
}
