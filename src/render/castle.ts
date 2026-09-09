import * as THREE from 'three';
import { stoneTextures, woodTextures, slateTextures, projectUvs } from './textures';
import { PhotoLibrary, applyPbr } from './assets';

/**
 * The castle's pieces, built to read as a medieval keep rather than a pile of
 * blocks: stone-textured walls with a walkway and slim merlons, octagonal
 * corner towers with parapets, a keep whose tower rises to a slate spire,
 * and a pointed gate arch. Pieces are merged per material by SceneryView;
 * {@link finishCastleMesh} projects the textures across the merged result so
 * blocks tile continuously.
 */

export interface CastleMaterials {
  stone: THREE.MeshStandardMaterial;
  /** Lighter dressed stone for tops and caps. */
  stoneLight: THREE.MeshStandardMaterial;
  /** Plain dressed stone for merlons and copings, where bricks would look busy. */
  stonePlain: THREE.MeshStandardMaterial;
  slate: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  flag: THREE.MeshStandardMaterial;
}

/**
 * Procedural stone, slate and planking by default; the scanned Poly Haven
 * sets take over wherever they loaded.
 */
export function makeCastleMaterials(photos?: PhotoLibrary): CastleMaterials {
  const stone = stoneTextures('#9a968a', 3);
  const stoneLight = stoneTextures('#aeaa9c', 5);
  const slate = slateTextures('#4a4f5c', 7);
  const wood = woodTextures('#7a5632', 11);
  const textured = (t: { albedo: THREE.Texture; normal: THREE.Texture }, roughness: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ map: t.albedo, normalMap: t.normal, roughness, metalness: 0, envMapIntensity: 0.5 });
  const light = applyPbr(textured(stoneLight, 0.9), photos?.wall);
  if (photos?.wall) light.color.setHex(0xd6d2c6);
  return {
    stone: applyPbr(textured(stone, 0.92), photos?.wall),
    stoneLight: light,
    stonePlain: applyPbr(
      new THREE.MeshStandardMaterial({ color: photos?.wall ? 0xdad6cb : 0xa8a396, roughness: 0.88, envMapIntensity: 0.5 }),
      photos?.wall,
    ),
    slate: applyPbr(textured(slate, 0.7), photos?.roof),
    wood: applyPbr(textured(wood, 0.85), photos?.planks),
    dark: new THREE.MeshStandardMaterial({ color: 0x1e1a15, roughness: 0.8, envMapIntensity: 0.3 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd8b24a, roughness: 0.35, metalness: 0.85, envMapIntensity: 1 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xb83232, roughness: 0.7, side: THREE.DoubleSide, envMapIntensity: 0.4 }),
  };
}

/** Textured materials need world-space UVs after merging. */
export function finishCastleMesh(geo: THREE.BufferGeometry, material: THREE.Material): void {
  if ((material as THREE.MeshStandardMaterial).map) projectUvs(geo, 0.5);
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** A slim, slightly tapered merlon in plain dressed stone. */
function merlon(m: CastleMaterials, x: number, y: number, z: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.11, 0.13, 0.36, 4);
  geo.rotateY(Math.PI / 4);
  geo.scale(1.3, 1, 1.3);
  return mesh(geo, m.stonePlain, x, y, z);
}

/** One tile of curtain wall: a textured slab with a coping and merlons on both faces. */
export function buildWall(m: CastleMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.add(mesh(box(1.0, 2.9, 0.8), m.stone, 0, 1.15, 0));
  g.add(mesh(box(1.0, 0.1, 0.9), m.stonePlain, 0, 2.62, 0));
  for (const x of [-0.25, 0.25]) {
    for (const z of [-0.36, 0.36]) g.add(merlon(m, x, 2.85, z));
  }
  return g;
}

/** An octagonal corner tower with a parapet of merlons and arrow slits. */
export function buildTower(m: CastleMaterials): THREE.Object3D {
  const g = new THREE.Group();
  const shaft = new THREE.CylinderGeometry(0.88, 0.98, 4.3, 8);
  shaft.rotateY(Math.PI / 8);
  g.add(mesh(shaft, m.stone, 0, 1.85, 0));
  const cap = new THREE.CylinderGeometry(1.02, 0.95, 0.24, 8);
  cap.rotateY(Math.PI / 8);
  g.add(mesh(cap, m.stonePlain, 0, 4.06, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    g.add(merlon(m, Math.cos(a) * 0.9, 4.33, Math.sin(a) * 0.9));
  }
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const slit = mesh(box(0.1, 0.5, 0.06), m.dark, Math.sin(a) * 0.93, 2.6, Math.cos(a) * 0.93);
    slit.rotation.y = a;
    g.add(slit);
  }
  return g;
}

/** The gate: two jambs and a pointed arch, crowned like the wall. */
export function buildGate(m: CastleMaterials): THREE.Object3D {
  const g = new THREE.Group();
  for (const side of [-0.5, 0.5]) g.add(mesh(box(0.34, 3.2, 0.8), m.stone, side, 1.3, 0));
  g.add(mesh(box(1.34, 0.5, 0.8), m.stone, 0, 2.7, 0));
  for (const x of [-0.3, 0.3]) g.add(merlon(m, x, 3.62, 0));
  const peak = new THREE.CylinderGeometry(0.0, 0.7, 0.5, 4);
  peak.rotateY(Math.PI / 4);
  peak.scale(1.34 / 1.4, 1, 0.8 / 1.4);
  g.add(mesh(peak, m.stone, 0, 3.2, 0));
  // Portcullis bars, drawn up into the arch.
  for (let x = -0.35; x <= 0.36; x += 0.14) g.add(mesh(box(0.04, 0.5, 0.04), m.dark, x, 2.2, 0));
  return g;
}

/** The keep: a stone block, an octagonal tower, a slate spire, and the pennant. */
export function buildKeep(m: CastleMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.add(mesh(box(3.0, 3.4, 3.0), m.stone, 0, 1.4, 0));
  g.add(mesh(box(3.2, 0.14, 3.2), m.stonePlain, 0, 3.12, 0));
  for (let t = -1.25; t <= 1.26; t += 0.5) {
    for (const [x, z] of [
      [t, -1.5],
      [t, 1.5],
      [-1.5, t],
      [1.5, t],
    ] as const) {
      g.add(merlon(m, x, 3.37, z));
    }
  }
  const tower = new THREE.CylinderGeometry(1.0, 1.1, 2.8, 8);
  tower.rotateY(Math.PI / 8);
  g.add(mesh(tower, m.stone, 0, 4.5, 0));
  const spire = new THREE.ConeGeometry(1.25, 2.4, 8);
  spire.rotateY(Math.PI / 8);
  g.add(mesh(spire, m.slate, 0, 7.05, 0));
  g.add(mesh(box(0.06, 1.3, 0.06), m.wood, 0, 8.7, 0));
  g.add(mesh(box(0.6, 0.36, 0.03), m.flag, 0.32, 9.1, 0));
  // Doorway on the south face and slit windows.
  g.add(mesh(box(0.7, 1.3, 0.1), m.dark, 0, 0.65, -1.5));
  for (const [x, z] of [
    [-0.9, -1.51],
    [0.9, -1.51],
    [-0.9, 1.51],
    [0.9, 1.51],
    [-1.51, 0],
    [1.51, 0],
  ] as const) {
    g.add(mesh(box(z === 0 ? 0.08 : 0.14, 0.5, z === 0 ? 0.14 : 0.08), m.dark, x, 1.9, z));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const w = mesh(box(0.1, 0.5, 0.06), m.dark, Math.sin(a) * 1.06, 4.7, Math.cos(a) * 1.06);
    w.rotation.y = a;
    g.add(w);
  }
  return g;
}

/** A bank counter: oak boards, a slate top, and a gilt grille. */
export function buildBankBooth(m: CastleMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.add(mesh(box(0.92, 0.9, 0.5), m.wood, 0, 0.45, 0));
  g.add(mesh(box(1.0, 0.1, 0.62), m.slate, 0, 0.95, 0));
  g.add(mesh(box(1.0, 0.08, 0.62), m.wood, 0, 1.72, 0));
  for (let x = -0.4; x <= 0.41; x += 0.16) g.add(mesh(box(0.03, 0.7, 0.03), m.gold, x, 1.35, 0));
  return g;
}

/** A stone altar with a gilt cross. */
export function buildAltar(m: CastleMaterials): THREE.Object3D {
  const g = new THREE.Group();
  const base = new THREE.CylinderGeometry(0.5, 0.56, 0.7, 6);
  base.scale(1, 1, 0.7);
  g.add(mesh(base, m.stone, 0, 0.35, 0));
  g.add(mesh(box(1.05, 0.14, 0.78), m.stoneLight, 0, 0.77, 0));
  g.add(mesh(box(0.06, 0.4, 0.06), m.gold, 0, 1.04, 0));
  g.add(mesh(box(0.24, 0.06, 0.06), m.gold, 0, 1.1, 0));
  return g;
}

/** The kitchen range: an iron hob on a stone base with a fire door and flue. */
export function buildRange(m: CastleMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.add(mesh(box(0.9, 0.5, 0.7), m.stone, 0, 0.25, 0));
  g.add(mesh(box(0.92, 0.42, 0.72), m.dark, 0, 0.71, 0));
  g.add(mesh(box(0.96, 0.06, 0.76), m.slate, 0, 0.95, 0));
  g.add(mesh(box(0.4, 0.22, 0.04), m.gold, 0, 0.66, 0.37));
  g.add(mesh(box(0.12, 0.7, 0.12), m.dark, 0.3, 1.3, -0.25));
  return g;
}

/** A squat stone furnace with a glowing mouth and a chimney. */
export function buildFurnace(m: CastleMaterials, ember: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.CylinderGeometry(0.42, 0.52, 1.4, 6);
  g.add(mesh(body, m.stone, 0, 0.7, 0));
  g.add(mesh(box(0.34, 0.3, 0.08), ember, 0, 0.5, 0.44));
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.0, 6), m.stone, 0.15, 1.8, -0.1));
  return g;
}

/** An anvil on a stump: horn, face, and a heavy waisted body. */
export function buildAnvil(m: CastleMaterials, iron: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.45, 6), m.wood, 0, 0.22, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.22, 6), iron, 0, 0.56, 0));
  g.add(mesh(box(0.62, 0.16, 0.34), iron, 0, 0.75, 0));
  const horn = new THREE.ConeGeometry(0.14, 0.3, 5);
  horn.rotateZ(-Math.PI / 2);
  g.add(mesh(horn, iron, 0.46, 0.75, 0));
  return g;
}

/** The timber bridge: planked deck, rails, posts. */
export function buildBridge(m: CastleMaterials, x0: number, x1: number, z0: number, z1: number): THREE.Group {
  const g = new THREE.Group();
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = x1 - x0;
  const d = z1 - z0 + 0.6;
  const deck = mesh(box(w, 0.14, d), m.wood, cx, -0.03, cz);
  deck.castShadow = true;
  deck.receiveShadow = true;
  g.add(deck);
  for (const sx of [x0 + 0.08, x1 - 0.08]) {
    g.add(mesh(box(0.08, 0.1, d), m.wood, sx, 0.5, cz));
    for (let z = cz - d / 2 + 0.12; z <= cz + d / 2; z += (d - 0.24) / 3) {
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.62, 6), m.wood, sx, 0.25, z));
    }
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      if (o.geometry.attributes.uv) projectUvs(o.geometry as THREE.BufferGeometry, 0.5);
    }
  });
  return g;
}
