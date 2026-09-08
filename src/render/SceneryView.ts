import * as THREE from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Prop } from '../sim/Scenery';
import { World } from '../sim/World';
import { Terrain } from './Terrain';
import { box, flat, place, seedAt, seededRandom, shadowed, taperedBox } from './lowpoly';

/** Where a gatherable prop's instances live, so the sim can hide/show them. */
interface ResourceVisual {
  /** Instanced slots making up the intact prop (trunk + canopy, or boulders). */
  slots: Array<{ mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }>;
  /** Lazily-built depleted stand-in (stump / rubble). */
  depleted?: THREE.Object3D;
  buildDepleted: () => THREE.Object3D;
  isDepleted: boolean;
}

/** Canopy lump layout: [x, y-above-base, z, radius]. */
type Lumps = ReadonlyArray<readonly [number, number, number, number]>;

/** The three tree silhouettes in the clearing. */
interface TreeStyle {
  lumps: Lumps;
  base: number;
  trunkScale: number;
  leaf: THREE.Color;
  leafAlt: THREE.Color;
  squash: number;
}

const TREE_STYLES: Record<'regular' | 'oak' | 'willow', TreeStyle> = {
  regular: {
    lumps: [
      [0, 0, 0, 0.74],
      [0.4, 0.2, 0.2, 0.5],
      [-0.36, 0.16, -0.22, 0.52],
      [0.04, 0.56, -0.06, 0.48],
      [-0.06, -0.1, 0.42, 0.42],
    ],
    base: 1.35,
    trunkScale: 1,
    leaf: new THREE.Color(0x3f7f34),
    leafAlt: new THREE.Color(0x5a9a3e),
    squash: 1,
  },
  oak: {
    lumps: [
      [0, 0.1, 0, 0.95],
      [0.62, 0.2, 0.3, 0.62],
      [-0.6, 0.1, -0.3, 0.64],
      [0.1, 0.75, -0.1, 0.6],
      [-0.2, 0.05, 0.62, 0.54],
      [0.3, -0.05, -0.6, 0.5],
    ],
    base: 1.55,
    trunkScale: 1.25,
    leaf: new THREE.Color(0x2f6a2a),
    leafAlt: new THREE.Color(0x477f33),
    squash: 0.92,
  },
  willow: {
    lumps: [
      [0, 0.1, 0, 0.8],
      [0.5, -0.15, 0.25, 0.55],
      [-0.5, -0.2, -0.2, 0.55],
      [0.05, 0.55, -0.05, 0.5],
      [-0.1, -0.3, 0.55, 0.45],
    ],
    base: 1.9,
    trunkScale: 1.5,
    leaf: new THREE.Color(0x7aa650),
    leafAlt: new THREE.Color(0x93b85f),
    squash: 1.25,
  },
};

/**
 * Renders the static, decorative world: trees, boulders, and the castle — all
 * hard-edged, flat-shaded low-poly in the OSRS spirit.
 *
 * Draw-call budget is the whole design here. The castle — hundreds of wall
 * blocks and merlons — is baked into ONE merged mesh per material. Trees and
 * rocks, which must be hidden individually when the sim depletes them, are
 * drawn with a handful of InstancedMeshes; a depleted node just zeroes its
 * instance matrices and shows a small stump or rubble mesh instead.
 */
export class SceneryView {
  private readonly root = new THREE.Group();
  private readonly geo = makeGeometries();
  private readonly mat = makeMaterials();
  /** Gatherable props keyed by "x,y". */
  private readonly resources = new Map<string, ResourceVisual>();
  private readonly zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly waterTiles = new Set<string>();

  constructor(
    scene: THREE.Scene,
    props: ReadonlyArray<Prop>,
    private readonly terrain: Terrain,
  ) {
    for (const p of props) if (p.kind === 'water') this.waterTiles.add(`${p.tile.x},${p.tile.y}`);
    const trees = props.filter((p) => p.kind === 'tree');
    const rocks = props.filter((p) => p.kind === 'rock');
    const castle = props.filter(
      (p) => p.kind !== 'tree' && p.kind !== 'rock' && p.kind !== 'water',
    );

    this.buildCastleMerged(castle);
    this.buildTreesInstanced(trees);
    this.buildRocksInstanced(rocks);
    scene.add(this.root);
  }

  /** Swap gatherable props between intact and depleted to match the sim. */
  sync(world: World): void {
    for (const node of world.resourceNodes.values()) {
      const visual = this.resources.get(`${node.tile.x},${node.tile.y}`);
      if (!visual) continue;
      const spent = node.regrowTimer > 0;
      if (visual.isDepleted === spent) continue;
      visual.isDepleted = spent;

      for (const slot of visual.slots) {
        slot.mesh.setMatrixAt(slot.index, spent ? this.zeroMatrix : slot.matrix);
        slot.mesh.instanceMatrix.needsUpdate = true;
      }
      if (spent && !visual.depleted) {
        visual.depleted = visual.buildDepleted();
        this.root.add(visual.depleted);
      }
      if (visual.depleted) visual.depleted.visible = spent;
    }
  }

  /** Which silhouette a tree gets: willows by the water, the odd oak, else regular. */
  treeStyleOf(prop: Prop): keyof typeof TREE_STYLES {
    const { x, y } = prop.tile;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (this.waterTiles.has(`${x + dx},${y + dy}`)) return 'willow';
      }
    }
    return prop.seed < 0.14 ? 'oak' : 'regular';
  }

  // --- Castle: bake everything into one mesh per material -------------------

  private buildCastleMerged(props: ReadonlyArray<Prop>): void {
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const collect = (group: THREE.Object3D): void => {
      group.updateMatrixWorld(true);
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          let geo = (o.geometry as THREE.BufferGeometry).clone();
          if (geo.index) geo = geo.toNonIndexed();
          geo.applyMatrix4(o.matrixWorld);
          const list = buckets.get(o.material as THREE.Material) ?? [];
          list.push(geo);
          buckets.set(o.material as THREE.Material, list);
        }
      });
    };

    for (const prop of props) {
      const obj = this.buildCastlePiece(prop);
      if (!obj) continue;
      obj.position.set(prop.tile.x, this.terrain.tileHeight(prop.tile), prop.tile.y);
      collect(obj);
    }

    for (const [material, geos] of buckets) {
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  private buildCastlePiece(prop: Prop): THREE.Object3D | null {
    switch (prop.kind) {
      case 'castle-wall':
        return this.buildWall();
      case 'castle-tower':
        return this.buildTower();
      case 'castle-gate':
        return this.buildGate();
      case 'castle-keep':
        return this.buildKeep();
      case 'bank-booth':
        return this.buildBankBooth();
      case 'altar':
        return this.buildAltar();
      case 'range':
        return this.buildRange();
      default:
        return null;
    }
  }

  /** The castle kitchen's iron range: a hob on a stone base with a fire door. */
  private buildRange(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(place(box(0.9, 0.5, 0.7), this.mat.stone, 0, 0.25, 0));
    g.add(place(box(0.92, 0.42, 0.72), this.mat.iron, 0, 0.71, 0));
    g.add(place(box(0.96, 0.06, 0.76), this.mat.dark, 0, 0.95, 0));
    for (const x of [-0.22, 0.22]) g.add(place(box(0.26, 0.03, 0.26), this.mat.dark, x, 0.99, 0));
    g.add(place(box(0.4, 0.22, 0.04), this.mat.dark, 0, 0.66, 0.37)); // fire door
    g.add(place(box(0.12, 0.7, 0.12), this.mat.iron, 0.3, 1.3, -0.25)); // flue
    return g;
  }

  /** A wooden counter with a barred grille — the castle's bank booth. */
  private buildBankBooth(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(place(box(0.92, 0.9, 0.5), this.mat.wood, 0, 0.45, 0));
    g.add(place(box(1.0, 0.1, 0.62), this.mat.woodLight, 0, 0.95, 0));
    g.add(place(box(1.0, 0.08, 0.62), this.mat.woodLight, 0, 1.72, 0));
    for (let x = -0.4; x <= 0.41; x += 0.16) {
      g.add(place(box(0.035, 0.7, 0.035), this.mat.iron, x, 1.35, 0));
    }
    g.add(place(box(0.5, 0.16, 0.03), this.mat.gold, 0, 1.12, 0.27));
    return g;
  }

  /** A stone altar with a gilt cross — recharge Prayer here. */
  private buildAltar(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(place(taperedBox(0.9, 0.7, 0.62, 0.9), this.mat.stone, 0, 0.35, 0));
    g.add(place(box(1.05, 0.14, 0.78), this.mat.stoneLight, 0, 0.77, 0));
    g.add(place(box(0.06, 0.4, 0.06), this.mat.gold, 0, 1.04, 0));
    g.add(place(box(0.24, 0.06, 0.06), this.mat.gold, 0, 1.1, 0));
    return g;
  }

  // --- Trees: two instanced meshes for the whole forest ---------------------

  private buildTreesInstanced(trees: ReadonlyArray<Prop>): void {
    let lumpTotal = 0;
    for (const t of trees) lumpTotal += TREE_STYLES[this.treeStyleOf(t)].lumps.length;

    const trunks = this.instanced(this.geo.trunk, this.mat.bark, Math.max(1, trees.length));
    const canopy = this.instanced(this.geo.canopy, this.mat.leaf, Math.max(1, lumpTotal));

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const tint = new THREE.Color();
    const barkTint = new THREE.Color();

    let trunkI = 0;
    let lumpI = 0;

    for (const tree of trees) {
      const style = TREE_STYLES[this.treeStyleOf(tree)];
      const seed = tree.seed;
      const s = 0.88 + seedAt(seed, 1) * 0.3; // whole-tree scale
      const yaw = seed * Math.PI * 2;
      const ground = this.terrain.tileHeight(tree.tile);
      const slots: ResourceVisual['slots'] = [];

      // Trunk: a 6-sided post sunk a little into the ground.
      quat.setFromAxisAngle(UP, yaw);
      pos.set(tree.tile.x, ground + 0.55 * s * style.trunkScale, tree.tile.y);
      scl.set(s, s * style.trunkScale, s);
      m.compose(pos, quat, scl);
      trunks.setMatrixAt(trunkI, m);
      barkTint.setHex(0x6b4a2f).offsetHSL(0, 0, (seedAt(seed, 2) - 0.5) * 0.08);
      trunks.setColorAt(trunkI, barkTint);
      slots.push({ mesh: trunks, index: trunkI, matrix: m.clone() });
      trunkI++;

      const base = style.base + seedAt(seed, 3) * 0.3;
      style.lumps.forEach(([bx, by, bz, r], li) => {
        pos.set(bx, base + by, bz).multiplyScalar(s).applyQuaternion(quat);
        pos.x += tree.tile.x;
        pos.y += ground;
        pos.z += tree.tile.y;
        // Each lump gets its own tumble so the facets don't line up.
        quat.setFromEuler(new THREE.Euler(seedAt(seed, li + 10) * 3, seedAt(seed, li + 20) * 6, seedAt(seed, li + 30) * 3));
        scl.set(r * s, r * s * style.squash, r * s);
        m.compose(pos, quat, scl);
        canopy.setMatrixAt(lumpI, m);
        tint.copy(style.leaf).lerp(style.leafAlt, seedAt(seed, li + 40));
        canopy.setColorAt(lumpI, tint);
        slots.push({ mesh: canopy, index: lumpI, matrix: m.clone() });
        lumpI++;
        quat.setFromAxisAngle(UP, yaw);
      });

      this.resources.set(`${tree.tile.x},${tree.tile.y}`, {
        slots,
        isDepleted: false,
        buildDepleted: () => this.buildStump(tree),
      });
    }

    for (const mesh of [trunks, canopy]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  // --- Rocks: one instanced mesh per boulder variant -------------------------

  private buildRocksInstanced(rocks: ReadonlyArray<Prop>): void {
    interface Boulder {
      variant: number;
      matrix: THREE.Matrix4;
      color: THREE.Color;
      tileKey: string;
    }
    const boulders: Boulder[] = [];

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const euler = new THREE.Euler();

    for (const rock of rocks) {
      const seed = rock.seed;
      const ground = this.terrain.tileHeight(rock.tile);
      const count = 2 + Math.floor(seed * 3);
      for (let i = 0; i < count; i++) {
        const s = seedAt(seed, i);
        const variant = Math.floor(seedAt(seed, i + 3) * this.geo.rocks.length);
        const size = 0.26 + s * 0.3;
        pos.set(
          rock.tile.x + (s - 0.5) * 0.6,
          ground + size * 0.35,
          rock.tile.y + (seedAt(seed, i + 9) - 0.5) * 0.6,
        );
        scl.set(size, size * (0.75 + s * 0.35), size);
        euler.set(s * 3, s * 6, s * 2);
        quat.setFromEuler(euler);
        // Grey stone with a copper-brown vein on the odd boulder.
        const color = new THREE.Color(0x8a857b).offsetHSL(0, 0, (seedAt(seed, i + 12) - 0.5) * 0.12);
        if (seedAt(seed, i + 15) < 0.4) color.lerp(new THREE.Color(0xb3703c), 0.45);
        boulders.push({
          variant,
          matrix: new THREE.Matrix4().compose(pos, quat, scl),
          color,
          tileKey: `${rock.tile.x},${rock.tile.y}`,
        });
      }
    }

    const perVariant = this.geo.rocks.map((geo, v) => {
      const count = boulders.filter((b) => b.variant === v).length;
      return this.instanced(geo, this.mat.rock, Math.max(1, count));
    });

    const nextIndex = this.geo.rocks.map(() => 0);
    for (const b of boulders) {
      const mesh = perVariant[b.variant];
      const index = nextIndex[b.variant]++;
      mesh.setMatrixAt(index, b.matrix);
      mesh.setColorAt(index, b.color);

      let visual = this.resources.get(b.tileKey);
      if (!visual) {
        const [x, y] = b.tileKey.split(',').map(Number);
        const seed = rocks.find((r) => r.tile.x === x && r.tile.y === y)!.seed;
        visual = {
          slots: [],
          isDepleted: false,
          buildDepleted: () => this.buildRubble(seed, x, y),
        };
        this.resources.set(b.tileKey, visual);
      }
      visual.slots.push({ mesh, index, matrix: b.matrix });
    }

    for (const mesh of perVariant) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private instanced(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  /** What's left after a tree is felled: a low cut trunk. */
  private buildStump(tree: Prop): THREE.Object3D {
    const g = new THREE.Group();
    g.add(place(this.geo.stump, this.mat.bark, 0, 0.14, 0));
    g.rotation.y = tree.seed * Math.PI * 2;
    g.position.set(tree.tile.x, this.terrain.tileHeight(tree.tile), tree.tile.y);
    return shadowed(g, true);
  }

  /** What's left after a rock is mined out: low, darker rubble. */
  private buildRubble(seed: number, x: number, y: number): THREE.Object3D {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = seedAt(seed, i + 20);
      const variant = this.geo.rocks[Math.floor(seedAt(seed, i + 23) * this.geo.rocks.length)];
      const rock = new THREE.Mesh(variant, this.mat.rubble);
      const size = 0.1 + s * 0.12;
      rock.scale.set(size, size * 0.6, size);
      rock.position.set((s - 0.5) * 0.5, size * 0.25, (seedAt(seed, i + 27) - 0.5) * 0.5);
      rock.rotation.set(s * 3, s * 6, s * 2);
      g.add(rock);
    }
    g.position.set(x, this.terrain.tileHeight({ x, y }), y);
    return shadowed(g, true);
  }

  private buildWall(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(place(this.geo.wall, this.mat.stone, 0, 1.05, 0));
    // Battlements: a walkway with a row of merlons along each face.
    g.add(place(box(1.0, 0.12, 1.0), this.mat.stoneLight, 0, 2.44, 0));
    for (const x of [-0.25, 0.25]) {
      for (const z of [-0.36, 0.36]) g.add(place(this.geo.merlon, this.mat.stoneLight, x, 2.66, z));
    }
    return g;
  }

  private buildTower(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(place(this.geo.tower, this.mat.stone, 0, 1.6, 0));
    g.add(place(box(1.7, 0.16, 1.7), this.mat.stoneLight, 0, 3.4, 0));
    // A ring of merlons around the square top.
    for (const t of [-0.6, -0.2, 0.2, 0.6]) {
      for (const [x, z] of [
        [t, -0.68],
        [t, 0.68],
        [-0.68, t],
        [0.68, t],
      ] as const) {
        g.add(place(this.geo.merlon, this.mat.stoneLight, x, 3.66, z));
      }
    }
    // Arrow slits, front and back.
    for (const z of [-0.76, 0.76]) g.add(place(box(0.12, 0.5, 0.06), this.mat.dark, 0, 2.2, z));
    return g;
  }

  private buildGate(): THREE.Object3D {
    // The gate tiles stay walkable; this is the arch overhead. Side jambs sit
    // on the tile edges so they don't crowd whoever walks through.
    const g = new THREE.Group();
    for (const side of [-0.5, 0.5]) g.add(place(this.geo.gateJamb, this.mat.stone, side, 1.25, 0));
    g.add(place(this.geo.gateLintel, this.mat.stone, 0, 2.7, 0));
    for (const x of [-0.25, 0.25]) {
      for (const z of [-0.36, 0.36]) g.add(place(this.geo.merlon, this.mat.stoneLight, x, 3.22, z));
    }
    return g;
  }

  private buildKeep(): THREE.Object3D {
    // One block spanning the 3x3 footprint at the heart of the castle, with a
    // taller square tower on top and a pennant for the skyline.
    const g = new THREE.Group();
    g.add(place(this.geo.keepBase, this.mat.stone, 0, 1.35, 0));
    g.add(place(box(3.1, 0.16, 3.1), this.mat.stoneLight, 0, 2.9, 0));
    for (let t = -1.25; t <= 1.26; t += 0.5) {
      for (const [x, z] of [
        [t, -1.4],
        [t, 1.4],
        [-1.4, t],
        [1.4, t],
      ] as const) {
        g.add(place(this.geo.merlon, this.mat.stoneLight, x, 3.16, z));
      }
    }
    g.add(place(this.geo.keepTower, this.mat.stone, 0, 4.0, 0));
    g.add(place(box(1.8, 0.14, 1.8), this.mat.stoneLight, 0, 5.1, 0));
    for (const t of [-0.6, -0.2, 0.2, 0.6]) {
      for (const [x, z] of [
        [t, -0.75],
        [t, 0.75],
        [-0.75, t],
        [0.75, t],
      ] as const) {
        g.add(place(this.geo.merlon, this.mat.stoneLight, x, 5.35, z));
      }
    }
    g.add(place(box(0.08, 1.6, 0.08), this.mat.wood, 0, 6.0, 0));
    g.add(place(this.geo.flag, this.mat.flag, 0.3, 6.55, 0));
    // A doorway on the south face and arrow-slit windows all round.
    g.add(place(box(0.7, 1.3, 0.1), this.mat.dark, 0, 0.65, -1.5));
    for (const [x, z] of [
      [-0.9, -1.51],
      [0.9, -1.51],
      [-0.9, 1.51],
      [0.9, 1.51],
      [-1.51, 0],
      [1.51, 0],
    ] as const) {
      g.add(place(box(z === 0 ? 0.08 : 0.16, 0.5, z === 0 ? 0.16 : 0.08), this.mat.dark, x, 1.9, z));
    }
    for (const [x, z] of [
      [0, -0.86],
      [0, 0.86],
      [-0.86, 0],
      [0.86, 0],
    ] as const) {
      g.add(place(box(x === 0 ? 0.16 : 0.08, 0.5, x === 0 ? 0.08 : 0.16), this.mat.dark, x, 4.2, z));
    }
    return g;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function makeGeometries() {
  return {
    trunk: new THREE.CylinderGeometry(0.13, 0.2, 1.3, 6),
    stump: new THREE.CylinderGeometry(0.17, 0.21, 0.28, 6),
    canopy: new THREE.IcosahedronGeometry(1, 1),
    rocks: [0, 1, 2].map((i) => makeBoulder(i)),
    // Walls and towers extend below ground so slopes never show a gap.
    wall: box(1.0, 2.7, 1.0),
    tower: box(1.6, 3.9, 1.6),
    merlon: box(0.3, 0.34, 0.26),
    gateJamb: box(0.34, 3.1, 1.0),
    gateLintel: box(1.34, 0.7, 1.0),
    keepBase: box(3.0, 3.3, 3.0),
    keepTower: box(1.7, 2.2, 1.7),
    flag: box(0.6, 0.36, 0.04),
  };
}

/**
 * A boulder: a dodecahedron with its vertices pushed around by noise so each
 * variant has lumps and creases, but with the facets left hard so it lights
 * like a chunk of RuneScape scenery rather than a pebble.
 */
function makeBoulder(variant: number): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const noise = new SimplexNoise(seededRandom(41 + variant));
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const off = variant * 13.7;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise.noise3d(v.x * 1.2 + off, v.y * 1.2, v.z * 1.2) * 0.22;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeMaterials() {
  return {
    bark: flat(0xffffff), // tinted per instance
    leaf: flat(0xffffff), // tinted per instance
    rock: flat(0xffffff), // tinted per instance
    rubble: flat(0x5c5a55),
    stone: flat(0xb3ada0),
    stoneLight: flat(0xc4bfb2),
    dark: flat(0x2a2622),
    wood: flat(0x5c3f24),
    woodLight: flat(0x8a6a3e),
    iron: flat(0x555a63),
    gold: flat(0xd8b24a),
    flag: flat(0xb83232, { side: THREE.DoubleSide }),
  };
}
