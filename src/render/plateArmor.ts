import * as THREE from 'three';
import { Rig, lathe, material, put, shade } from './characters';
import { HeadFrame, box, prism, wedge } from './gear';

/**
 * The plate set, the showcase armour: a cuirass with a raised breast ridge
 * and gold edging, a gorget, three-lame pauldrons, a belt with tassets
 * hanging over the thighs, cuisses with knee cops, ridged greaves, a crested
 * full helm and a bossed kite shield. Every piece is built in its socket's
 * frame from the rig's measurements, so it fits whatever body wears it; the
 * tier is a tint of the plates and the edging stays the same aged gold.
 * Everything here is original geometry.
 */

const TRIM = 0xcfa94e;
const STRAP = 0x3a2a1c;

/** A raised bead running around a revolve at height `y`: the edging on a plate. */
function bead(r: number, y: number, t: number, segments: number, flatten: number, m: THREE.Material): THREE.Mesh {
  return put(lathe([[r - t * 0.3, y - t], [r + t, y], [r - t * 0.3, y + t]], segments, flatten), m);
}

/** A narrow strip of a revolve, `phiLength` wide around `phiCentre` (0 = the front), hugging the profile. */
function strip(profile: ReadonlyArray<readonly [number, number]>, phiCentre: number, phiLength: number, flatten = 1, segments = 4): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, segments, phiCentre - phiLength / 2, phiLength);
  if (flatten !== 1) geo.scale(1, 1, flatten);
  geo.computeVertexNormals();
  return shade(geo);
}

/** A spherical cap `theta` of arc wide about the +y pole. */
function cap(r: number, theta: number, w = 16, h = 7): THREE.BufferGeometry {
  return shade(new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, theta));
}

/** Cuirass, gorget, pauldrons and belt, on the torso socket. */
export function plateCuirass(rig: Rig, color: number): THREE.Object3D {
  const d = rig.dims;
  const s = d.scale;
  const g = new THREE.Group();
  const m = material(color, 'metal');
  const trim = material(TRIM, 'metal');
  const strap = material(STRAP, 'leather');
  const fl = d.torsoFlatten;

  // The breastplate: the torso's own profile from the waist up, let out so
  // it sits over the tunic, and centred on the chest rather than the spine.
  const zc = d.torsoCentreZ;
  const rows = d.torsoProfile.filter(([, y]) => y > 0.02 * s).map(([r, y]) => [r * 1.08 + 0.008 * s, y] as const);
  const hem = rows[0];
  const collar = rows[rows.length - 1];
  g.add(put(lathe(rows, 28, fl), m, 0, 0, zc));
  // A raised ridge down the breast and a gold bead at the collar and the hem.
  g.add(put(strip(rows.map(([r, y]) => [r * 1.025, y] as const), 0, 0.22, fl), m, 0, 0, zc));
  g.add(put(strip(rows.map(([r, y]) => [r * 1.035, y] as const), 0, 0.07, fl), trim, 0, 0, zc));
  g.add(put(lathe([[collar[0] - 0.002 * s, collar[1] - 0.007 * s], [collar[0] + 0.007 * s, collar[1]], [collar[0] - 0.002 * s, collar[1] + 0.007 * s]], 28, fl), trim, 0, 0, zc));
  g.add(put(lathe([[hem[0] - 0.002 * s, hem[1] - 0.004 * s], [hem[0] + 0.008 * s, hem[1] + 0.004 * s], [hem[0] - 0.002 * s, hem[1] + 0.012 * s]], 28, fl), trim, 0, 0, zc));

  // The gorget: a flared collar around the neck's base.
  const neckR = d.headR * 0.82;
  g.add(put(lathe([[neckR * 1.15, d.torso - 0.015 * s], [neckR * 1.3, d.torso + 0.02 * s], [neckR * 1.36, d.torso + 0.045 * s]], 20, 0.9), m, 0, 0, zc * 0.6));
  g.add(put(lathe([[neckR * 1.34, d.torso + 0.04 * s], [neckR * 1.41, d.torso + 0.045 * s], [neckR * 1.34, d.torso + 0.05 * s]], 20, 0.9), trim, 0, 0, zc * 0.6));

  // Pauldrons: three overlapping lames per shoulder, each edged in gold,
  // stepping outward and down from the point of the shoulder.
  for (const sx of [-1, 1]) {
    const R = d.deltoidR * 1.2;
    const cx = sx * (d.shoulderHalf + 0.018 * s);
    const cy = d.shoulderY + 0.005 * s;
    const lames: Array<[number, number, number]> = [
      [1.0, 0, 0.62],
      [1.08, -0.028, 0.75],
      [1.16, -0.056, 0.85],
    ];
    for (const [k, drop, th] of lames) {
      const theta = Math.PI * 0.5 * th;
      const edge = put(cap(R * k * 0.985, theta + 0.1), trim, cx, cy + drop * s, 0);
      edge.scale.set(1, 0.9, 1);
      g.add(edge);
      const shell = put(cap(R * k, theta), m, cx, cy + drop * s, 0);
      shell.scale.set(1, 0.9, 1);
      g.add(shell);
    }
    // A boss on the point of the shoulder.
    g.add(put(cap(R * 0.3, Math.PI * 0.5, 10, 4), trim, cx, cy + R * 0.86, 0));
  }

  // The belt at the waist, with a buckle.
  g.add(put(lathe([[hem[0] * 0.995, hem[1] - 0.018 * s], [hem[0] * 1.02, hem[1] - 0.004 * s], [hem[0] * 0.995, hem[1] + 0.01 * s]], 28, fl), strap, 0, 0, zc));
  g.add(put(box(0.045 * s, 0.03 * s, 0.014 * s), trim, 0, hem[1] - 0.004 * s, zc + hem[0] * fl * 1.0));
  // The culet: a plate hanging off the back of the belt over the seat.
  const culet = put(wedge(0.17 * s, 0.14 * s, 0.012 * s, 0.75), m, 0, hem[1] - 0.08 * s, zc - (hem[0] * fl + 0.004 * s));
  culet.rotation.x = -0.18;
  g.add(culet);
  return g;
}

/**
 * Legs: a cuisse with a knee cop and two tassets hanging from the hip over
 * the front and outer thigh, and a greave with a ridge down the shin.
 * `side` is 1 for the left leg, -1 for the right. Returns [thigh, shin].
 */
export function plateLegs(rig: Rig, color: number, side: 1 | -1): [THREE.Object3D, THREE.Object3D] {
  const d = rig.dims;
  const s = d.scale;
  const m = material(color, 'metal');
  const trim = material(TRIM, 'metal');

  const thigh = new THREE.Group();
  thigh.add(put(prism(d.thighR * 1.12, d.shinR * 1.1, d.thigh * 0.92, 16), m, 0, -d.thigh / 2, 0));
  thigh.add(bead(d.thighR * 1.12, -0.04 * s, 0.006 * s, 16, 1, trim));
  // Tassets: curved plates hung from the hip, hugging the thigh and flaring
  // toward their gold-edged hems, one over the front and one over the outside.
  for (const [ang, width, drop] of [
    [0.45, 0.8, 0.21],
    [1.4, 0.7, 0.18],
  ]) {
    const phi = ang * side;
    const r0 = d.thighR * 1.24;
    const r1 = d.thighR * 1.36;
    const y1 = -drop * s;
    thigh.add(put(strip([[r0, -0.015 * s], [r0 * 1.02, -0.08 * s], [r1, y1]], phi, width, 1, 6), m));
    thigh.add(put(strip([[r1 - 0.004 * s, y1 - 0.007 * s], [r1 + 0.006 * s, y1], [r1 - 0.004 * s, y1 + 0.007 * s]], phi, width, 1, 6), trim));
  }
  // The knee cop over the joint, its pole facing forward.
  const cop = put(cap(d.shinR * 1.3, Math.PI * 0.5, 12, 5), m, 0, -d.thigh, 0.012 * s);
  cop.rotation.x = Math.PI / 2;
  cop.scale.set(1, 1, 0.75);
  thigh.add(cop);

  const shin = new THREE.Group();
  const profile: Array<readonly [number, number]> = [
    [d.shinR * 1.12, -0.02 * s],
    [d.shinR * 1.0, -d.shin * 0.5],
    [d.shinR * 0.78, -d.shin * 0.9],
  ];
  shin.add(put(lathe(profile, 16), m));
  shin.add(put(strip(profile.map(([r, y]) => [r * 1.05, y] as const), 0, 0.3), m));
  shin.add(bead(d.shinR * 1.12, -0.02 * s, 0.006 * s, 16, 1, trim));
  shin.add(bead(d.shinR * 0.78, -d.shin * 0.9, 0.005 * s, 16, 1, trim));
  return [thigh, shin];
}

/** The full helm: the skull boxed in, a visor slit, a gold brow band and a crest running front to back. */
export function plateHelm(h: HeadFrame, color: number): THREE.Object3D {
  const hr = h.hr;
  const g = new THREE.Group();
  const m = material(color, 'metal');
  const trim = material(TRIM, 'metal');
  const dark = material(0x14120f, 'dark');
  const span = h.top - h.brow;
  const onSkull = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => put(geo, mat, 0, 0, h.cz);
  g.add(
    onSkull(
      lathe(
        [
          [0.8 * hr, h.chin - 0.012],
          [1.1 * hr, h.chin + (h.brow - h.chin) * 0.4],
          [1.14 * hr, h.brow],
          [1.12 * hr, h.brow + span * 0.5],
          [0.98 * hr, h.brow + span * 0.88],
          [0.5 * hr, h.top + 0.025],
          [0, h.top + 0.04],
        ],
        24,
        h.flatten,
      ),
      m,
    ),
  );
  const front = h.cz + 1.06 * hr * h.flatten;
  // The visor: a T of darkness, and a gold band across the brow.
  g.add(put(box(0.16 * hr, (h.brow - h.chin) * 0.8, 0.1 * hr), dark, 0, (h.brow + h.chin) / 2, front));
  g.add(put(box(0.9 * hr, 0.14 * hr, 0.1 * hr), dark, 0, h.brow - 0.03, front));
  g.add(onSkull(lathe([[1.1 * hr, h.brow + 0.002], [1.17 * hr, h.brow + 0.012], [1.1 * hr, h.brow + 0.022]], 24, h.flatten), trim));
  // The crest: a fin along the crown, tapering to a comb.
  g.add(put(wedge(0.12 * hr, 0.5 * hr, 1.5 * hr, 0.25, 0.8), trim, 0, h.top + 0.04 + 0.12 * hr, h.cz - 0.1 * hr));
  // Cheek guards sweeping down past the jaw.
  for (const sx of [-1, 1]) {
    const cheek = put(wedge(0.3 * hr, (h.brow - h.chin) * 0.7, 0.9 * hr, 0.9, 0.7), m, sx * 1.02 * hr, h.chin + (h.brow - h.chin) * 0.3, h.cz + 0.2 * hr * h.flatten);
    cheek.rotation.z = sx * 0.12;
    g.add(cheek);
  }
  return g;
}

/** The kite shield: bevelled face, a gold rim behind it, a central boss and a cross. */
export function kiteShield(color: number): THREE.Object3D {
  const g = new THREE.Group();
  const m = material(color, 'metal');
  const trim = material(TRIM, 'metal');
  const outline = (k: number): THREE.Shape => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.17 * k, 0.2 * k);
    shape.lineTo(0.17 * k, 0.2 * k);
    shape.lineTo(0.19 * k, 0.02 * k);
    shape.lineTo(0.0, -0.3 * k);
    shape.lineTo(-0.19 * k, 0.02 * k);
    shape.closePath();
    return shape;
  };
  const face = new THREE.ExtrudeGeometry(outline(1), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 });
  face.computeVertexNormals();
  g.add(put(shade(face), m));
  const rim = new THREE.ExtrudeGeometry(outline(1.1), { depth: 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 });
  rim.computeVertexNormals();
  g.add(put(shade(rim), trim, 0, -0.012, -0.015));
  const boss = put(cap(0.06, Math.PI * 0.5, 14, 6), trim, 0, 0.0, 0.06);
  boss.rotation.x = Math.PI / 2;
  boss.scale.set(1, 1, 0.6);
  g.add(boss);
  g.add(put(box(0.025, 0.34, 0.012), trim, 0, -0.03, 0.062));
  g.add(put(box(0.24, 0.025, 0.012), trim, 0, 0.08, 0.062));
  return g;
}
