import * as THREE from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Prop } from '../sim/Scenery';
import { World } from '../sim/World';
import { Terrain } from './Terrain';
import { flat, seedAt, seededRandom } from './lowpoly';
import {
  CastleMaterials,
  buildAltar,
  buildAnvil,
  buildBankBooth,
  buildFurnace,
  buildGate,
  buildKeep,
  buildRange,
  buildTower,
  buildWall,
  finishCastleMesh,
  makeCastleMaterials,
} from './castle';

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
  /** Pyramid spikes poking out of the canopy: [x, y-above-base, z, length, tilt]. */
  spikes: ReadonlyArray<readonly [number, number, number, number, number]>;
  base: number;
  trunkScale: number;
  leaf: THREE.Color;
  leafAlt: THREE.Color;
  squash: number;
  /** Willows hang their spikes downward. */
  droop: boolean;
}

const TREE_STYLES: Record<'regular' | 'oak' | 'willow', TreeStyle> = {
  regular: {
    lumps: [
      [0, 0, 0, 0.7],
      [0.38, 0.18, 0.2, 0.48],
      [-0.34, 0.14, -0.22, 0.5],
      [0.04, 0.5, -0.06, 0.46],
      [-0.06, -0.1, 0.4, 0.4],
    ],
    spikes: [
      [0.55, 0.1, 0.3, 0.55, 0.9],
      [-0.5, 0.05, -0.35, 0.5, -0.9],
      [0.1, 0.75, 0.05, 0.55, 0.1],
      [-0.2, 0.2, 0.55, 0.45, 0.7],
    ],
    base: 1.4,
    trunkScale: 1,
    leaf: new THREE.Color(0x3f7f34),
    leafAlt: new THREE.Color(0x5a9a3e),
    squash: 1,
    droop: false,
  },
  oak: {
    lumps: [
      [0, 0.1, 0, 0.92],
      [0.62, 0.2, 0.3, 0.6],
      [-0.6, 0.1, -0.3, 0.62],
      [0.1, 0.72, -0.1, 0.58],
      [-0.2, 0.05, 0.62, 0.52],
      [0.3, -0.05, -0.6, 0.48],
    ],
    spikes: [
      [0.9, 0.25, 0.4, 0.6, 1.0],
      [-0.85, 0.15, -0.4, 0.6, -1.0],
      [0.15, 1.05, 0.0, 0.6, 0.05],
      [-0.3, 0.3, 0.85, 0.5, 0.8],
      [0.5, 0.2, -0.85, 0.5, -0.6],
    ],
    base: 1.6,
    trunkScale: 1.25,
    leaf: new THREE.Color(0x2f6a2a),
    leafAlt: new THREE.Color(0x477f33),
    squash: 0.92,
    droop: false,
  },
  willow: {
    lumps: [
      [0, 0.1, 0, 0.78],
      [0.5, -0.15, 0.25, 0.52],
      [-0.5, -0.2, -0.2, 0.52],
      [0.05, 0.5, -0.05, 0.48],
      [-0.1, -0.3, 0.55, 0.42],
    ],
    spikes: [
      [0.75, -0.3, 0.35, 0.9, 0],
      [-0.7, -0.35, -0.3, 0.9, 0],
      [0.1, -0.4, 0.8, 0.85, 0],
      [-0.2, -0.35, -0.75, 0.8, 0],
      [0.6, -0.3, -0.5, 0.8, 0],
    ],
    base: 1.95,
    trunkScale: 1.5,
    leaf: new THREE.Color(0x7aa650),
    leafAlt: new THREE.Color(0x93b85f),
    squash: 1.2,
    droop: true,
  },
};

/**
 * Renders the static, decorative world: trees, boulders, and the castle.
 *
 * Draw-call budget is the whole design here. The castle — hundreds of wall
 * blocks and merlons — is baked into ONE merged mesh per material, with the
 * stone texture projected across the result. Trees and rocks, which must be
 * hidden individually when the sim depletes them, are drawn with a handful
 * of InstancedMeshes; a depleted node just zeroes its instance matrices and
 * shows a small stump or rubble mesh instead.
 */
export class SceneryView {
  private readonly root = new THREE.Group();
  private readonly geo = makeGeometries();
  private readonly mat = makeMaterials();
  private readonly castleMat: CastleMaterials = makeCastleMaterials();
  /** Gatherable props keyed by "x,y". */
  private readonly resources = new Map<string, ResourceVisual>();
  private readonly zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    scene: THREE.Scene,
    props: ReadonlyArray<Prop>,
    private readonly terrain: Terrain,
  ) {
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

  /** Which silhouette a tree gets: the world builder's variant, else regular. */
  treeStyleOf(prop: Prop): keyof typeof TREE_STYLES {
    if (prop.variant === 'oak' || prop.variant === 'willow') return prop.variant;
    return 'regular';
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
          // Merging needs matching attribute sets; drop anything but the basics.
          for (const name of Object.keys(geo.attributes)) {
            if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
          }
          if (!geo.attributes.uv) {
            geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
          }
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
      finishCastleMesh(merged, material);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  private buildCastlePiece(prop: Prop): THREE.Object3D | null {
    const m = this.castleMat;
    switch (prop.kind) {
      case 'castle-wall':
        return buildWall(m);
      case 'castle-tower':
        return buildTower(m);
      case 'castle-gate':
        return buildGate(m);
      case 'castle-keep':
        return buildKeep(m);
      case 'bank-booth':
        return buildBankBooth(m);
      case 'altar':
        return buildAltar(m);
      case 'range':
        return buildRange(m);
      case 'furnace':
        return buildFurnace(m, this.mat.ember);
      case 'anvil':
        return buildAnvil(m, this.mat.iron);
      default:
        return null;
    }
  }

  // --- Trees: three instanced meshes for the whole forest -------------------

  private buildTreesInstanced(trees: ReadonlyArray<Prop>): void {
    let lumpTotal = 0;
    let spikeTotal = 0;
    for (const t of trees) {
      const style = TREE_STYLES[this.treeStyleOf(t)];
      lumpTotal += style.lumps.length;
      spikeTotal += style.spikes.length;
    }

    const trunks = this.instanced(this.geo.trunk, this.mat.bark, Math.max(1, trees.length));
    const canopy = this.instanced(this.geo.canopy, this.mat.leaf, Math.max(1, lumpTotal));
    const spikes = this.instanced(this.geo.spike, this.mat.leaf, Math.max(1, spikeTotal));

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const tint = new THREE.Color();
    const barkTint = new THREE.Color();
    const euler = new THREE.Euler();

    let trunkI = 0;
    let lumpI = 0;
    let spikeI = 0;

    for (const tree of trees) {
      const style = TREE_STYLES[this.treeStyleOf(tree)];
      const seed = tree.seed;
      const s = 0.88 + seedAt(seed, 1) * 0.3; // whole-tree scale
      const yaw = seed * Math.PI * 2;
      const ground = this.terrain.tileHeight(tree.tile);
      const slots: ResourceVisual['slots'] = [];

      // Trunk: a tapered six-sided post sunk a little into the ground.
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
        quat.setFromEuler(euler.set(seedAt(seed, li + 10) * 3, seedAt(seed, li + 20) * 6, seedAt(seed, li + 30) * 3));
        scl.set(r * s, r * s * style.squash, r * s);
        m.compose(pos, quat, scl);
        canopy.setMatrixAt(lumpI, m);
        tint.copy(style.leaf).lerp(style.leafAlt, seedAt(seed, li + 40));
        canopy.setColorAt(lumpI, tint);
        slots.push({ mesh: canopy, index: lumpI, matrix: m.clone() });
        lumpI++;
        quat.setFromAxisAngle(UP, yaw);
      });

      // Spikes: pyramids jutting from the canopy give the jagged RuneScape outline.
      style.spikes.forEach(([bx, by, bz, len, tilt], si) => {
        pos.set(bx, base + by, bz).multiplyScalar(s).applyQuaternion(quat);
        pos.x += tree.tile.x;
        pos.y += ground;
        pos.z += tree.tile.y;
        const outward = Math.atan2(bx, bz) + yaw; // lean away from the trunk
        if (style.droop) euler.set(Math.PI, seedAt(seed, si + 50) * 6, 0);
        else euler.set(Math.cos(outward) * tilt, 0, -Math.sin(outward) * tilt, 'YXZ');
        quat.setFromEuler(euler);
        scl.set(0.45 * s, len * s, 0.45 * s);
        m.compose(pos, quat, scl);
        spikes.setMatrixAt(spikeI, m);
        tint.copy(style.leafAlt).lerp(style.leaf, seedAt(seed, si + 60));
        spikes.setColorAt(spikeI, tint);
        slots.push({ mesh: spikes, index: spikeI, matrix: m.clone() });
        spikeI++;
        quat.setFromAxisAngle(UP, yaw);
      });

      this.resources.set(`${tree.tile.x},${tree.tile.y}`, {
        slots,
        isDepleted: false,
        buildDepleted: () => this.buildStump(tree),
      });
    }

    for (const mesh of [trunks, canopy, spikes]) {
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
        // Grey stone, veined with the ore it holds: copper-brown, tin-silver, iron-rust.
        const color = new THREE.Color(0x8a857b).offsetHSL(0, 0, (seedAt(seed, i + 12) - 0.5) * 0.12);
        const vein = rock.variant === 'tin' ? 0xc9ccd4 : rock.variant === 'iron' ? 0x8a4a2a : 0xb3703c;
        if (seedAt(seed, i + 15) < 0.5) color.lerp(new THREE.Color(vein), 0.5);
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
    const stump = new THREE.Mesh(this.geo.stump, this.mat.barkPlain);
    stump.position.y = 0.14;
    stump.castShadow = true;
    g.add(stump);
    g.rotation.y = tree.seed * Math.PI * 2;
    g.position.set(tree.tile.x, this.terrain.tileHeight(tree.tile), tree.tile.y);
    return g;
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
      rock.castShadow = true;
      g.add(rock);
    }
    g.position.set(x, this.terrain.tileHeight({ x, y }), y);
    return g;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function makeGeometries() {
  const trunk = new THREE.CylinderGeometry(0.11, 0.2, 1.3, 6);
  return {
    trunk,
    stump: new THREE.CylinderGeometry(0.17, 0.21, 0.28, 6),
    canopy: new THREE.IcosahedronGeometry(1, 0),
    spike: new THREE.ConeGeometry(1, 1, 4),
    rocks: [0, 1, 2].map((i) => makeBoulder(i)),
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
    bark: new THREE.MeshLambertMaterial({ color: 0xffffff }), // smooth-shaded, tinted per instance
    barkPlain: new THREE.MeshLambertMaterial({ color: 0x6b4a2f }),
    leaf: flat(0xffffff), // faceted, tinted per instance
    rock: flat(0xffffff), // faceted, tinted per instance
    rubble: flat(0x5c5a55),
    iron: new THREE.MeshLambertMaterial({ color: 0x555a63 }),
    ember: new THREE.MeshBasicMaterial({ color: 0xff7a1a }),
  };
}
