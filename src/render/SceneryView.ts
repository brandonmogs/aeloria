import * as THREE from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Prop } from '../sim/Scenery';
import { World } from '../sim/World';
import { Terrain } from './Terrain';
import { seedAt, seededRandom } from './lowpoly';
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
import { LeafKind, barkTextures, leafTexture, rockTextures } from './foliageTextures';
import { projectUvs } from './textures';
import { PhotoLibrary, applyPbr } from './assets';
import { LightPool } from './LightPool';

/** Where a gatherable prop's instances live, so the sim can hide/show them. */
interface ResourceVisual {
  /** Instanced slots making up the intact prop (trunk + canopy, or boulders). */
  slots: Array<{ mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }>;
  /** Lazily-built depleted stand-in (stump / rubble). */
  depleted?: THREE.Object3D;
  buildDepleted: () => THREE.Object3D;
  isDepleted: boolean;
}

/** Leaf clusters: [x, y, z, size] relative to the trunk base, in tree units. */
type Clusters = ReadonlyArray<readonly [number, number, number, number]>;

/** The three tree silhouettes in the clearing. */
interface TreeStyle {
  clusters: Clusters;
  /** Hanging strand cards for willows: [x, y-top, z, width, height]. */
  strands: ReadonlyArray<readonly [number, number, number, number, number]>;
  /** The point the canopy's lighting normals radiate from. */
  canopy: readonly [number, number, number];
  trunkScale: number;
  leaf: LeafKind;
  tint: THREE.Color;
  tintAlt: THREE.Color;
}

const TREE_STYLES: Record<'regular' | 'oak' | 'willow', TreeStyle> = {
  regular: {
    clusters: [
      [0, 1.85, 0, 1.7],
      [0.5, 1.6, 0.3, 1.35],
      [-0.5, 1.65, -0.25, 1.4],
      [0.1, 2.3, -0.1, 1.3],
      [-0.1, 1.55, 0.55, 1.2],
    ],
    strands: [],
    canopy: [0, 1.8, 0],
    trunkScale: 1,
    leaf: 'broad',
    tint: new THREE.Color(1.0, 1.0, 0.92),
    tintAlt: new THREE.Color(0.86, 1.0, 0.8),
  },
  oak: {
    clusters: [
      [0, 2.2, 0, 2.2],
      [0.8, 1.9, 0.4, 1.7],
      [-0.8, 2.0, -0.4, 1.7],
      [0.2, 2.8, -0.2, 1.6],
      [-0.3, 1.8, 0.8, 1.5],
      [0.4, 1.9, -0.9, 1.5],
    ],
    strands: [],
    canopy: [0, 2.15, 0],
    trunkScale: 1.35,
    leaf: 'oak',
    tint: new THREE.Color(0.9, 0.95, 0.8),
    tintAlt: new THREE.Color(0.8, 0.9, 0.7),
  },
  willow: {
    clusters: [
      [0, 2.4, 0, 1.9],
      [0.6, 2.2, 0.4, 1.4],
      [-0.6, 2.25, -0.4, 1.4],
      [0, 2.85, 0, 1.3],
    ],
    strands: [
      [0.9, 2.5, 0.3, 0.9, 1.9],
      [-0.9, 2.5, -0.3, 0.9, 1.9],
      [0.3, 2.5, -0.9, 0.9, 1.8],
      [-0.3, 2.5, 0.9, 0.9, 1.8],
      [0.75, 2.4, -0.7, 0.8, 1.7],
      [-0.75, 2.4, 0.7, 0.8, 1.7],
    ],
    canopy: [0, 2.3, 0],
    trunkScale: 1.55,
    leaf: 'broad',
    tint: new THREE.Color(1.05, 1.05, 0.75),
    tintAlt: new THREE.Color(1.0, 1.02, 0.7),
  },
};

/** Cards per leaf cluster: two crossed uprights and a tilted lid. */
const CARDS_PER_CLUSTER = 3;

/**
 * Renders the static, decorative world: trees, boulders, and the castle.
 *
 * Trees are built the way RuneScape's always were: a textured trunk with a few
 * branches under a canopy of alpha-tested leaf-cluster cards. Each cluster is
 * three crossed quads so it reads from every angle, the cards' lighting
 * normals radiate from the canopy's centre so the whole crown shades like one
 * mass rather than a fan of flat planes, and a vertex-shader breeze sways them.
 *
 * Draw-call budget is the whole design here. The castle, hundreds of wall
 * blocks and merlons, is baked into ONE merged mesh per material with the
 * stone texture projected across the result. Trees and rocks, which must be
 * hidden individually when the sim depletes them, are drawn with a handful of
 * InstancedMeshes; a depleted node just zeroes its instance matrices and shows
 * a small stump or rubble mesh instead.
 */
export class SceneryView {
  private readonly root = new THREE.Group();
  private readonly leafTime = { value: 0 };
  private readonly geo = makeGeometries();
  private readonly mat: ReturnType<typeof makeMaterials>;
  private readonly castleMat: CastleMaterials;
  /** Gatherable props keyed by "x,y". */
  private readonly resources = new Map<string, ResourceVisual>();
  private readonly zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  /** World positions of furnace mouths, lit each frame. */
  private readonly furnaces: THREE.Vector3[] = [];
  private clock = 0;

  constructor(
    scene: THREE.Scene,
    props: ReadonlyArray<Prop>,
    private readonly terrain: Terrain,
    photos?: PhotoLibrary,
  ) {
    this.mat = makeMaterials(this.leafTime, photos);
    this.castleMat = makeCastleMaterials(photos);
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

  /** Advance the breeze and light the furnaces. */
  update(dt: number, lights?: LightPool): void {
    this.leafTime.value += dt;
    this.clock += dt;
    if (!lights) return;
    for (const f of this.furnaces) {
      const flicker = 0.85 + 0.15 * Math.sin(this.clock * 11 + f.x);
      lights.add(f.x, f.y + 0.5, f.z + 0.35, 0xff7a20, 4.5 * flicker, 4.5);
    }
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
      if (prop.kind === 'furnace') this.furnaces.push(obj.position.clone());
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

  // --- Trees: a trunk mesh and a card mesh per leaf texture ------------------

  private buildTreesInstanced(trees: ReadonlyArray<Prop>): void {
    const cardCounts = { broad: 0, oak: 0, willow: 0 };
    for (const t of trees) {
      const style = TREE_STYLES[this.treeStyleOf(t)];
      cardCounts[style.leaf] += style.clusters.length * CARDS_PER_CLUSTER;
      cardCounts.willow += style.strands.length;
    }

    const trunks = this.instanced(this.geo.trunk, this.mat.bark, Math.max(1, trees.length));
    const cards = {
      broad: this.cardMesh(this.geo.card, this.mat.leafBroad, cardCounts.broad),
      oak: this.cardMesh(this.geo.card, this.mat.leafOak, cardCounts.oak),
      willow: this.cardMesh(this.geo.strand, this.mat.leafWillow, cardCounts.willow),
    };
    const next = { broad: 0, oak: 0, willow: 0 };

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const tint = new THREE.Color();
    const barkTint = new THREE.Color();
    const euler = new THREE.Euler();
    const canopy = new THREE.Vector3();

    let trunkI = 0;
    for (const tree of trees) {
      const style = TREE_STYLES[this.treeStyleOf(tree)];
      const seed = tree.seed;
      const s = 0.88 + seedAt(seed, 1) * 0.3; // whole-tree scale
      const yaw = seed * Math.PI * 2;
      const ground = this.terrain.tileHeight(tree.tile);
      const slots: ResourceVisual['slots'] = [];
      const base = new THREE.Vector3(tree.tile.x, ground, tree.tile.y);

      // Trunk: textured, branching, sunk a little into the ground.
      quat.setFromAxisAngle(UP, yaw);
      pos.set(base.x, base.y - 0.05, base.z);
      scl.set(s, s * style.trunkScale, s);
      m.compose(pos, quat, scl);
      trunks.setMatrixAt(trunkI, m);
      barkTint.setRGB(1, 1, 1).offsetHSL(0, 0, (seedAt(seed, 2) - 0.5) * 0.12);
      trunks.setColorAt(trunkI, barkTint);
      slots.push({ mesh: trunks, index: trunkI, matrix: m.clone() });
      trunkI++;

      canopy.set(style.canopy[0], style.canopy[1], style.canopy[2]).multiplyScalar(s).add(base);
      tint.copy(style.tint).lerp(style.tintAlt, seedAt(seed, 4));

      const placeCard = (
        mesh: THREE.InstancedMesh,
        kind: 'broad' | 'oak' | 'willow',
        x: number,
        y: number,
        z: number,
        w: number,
        h: number,
        yawC: number,
        tilt: number,
      ): void => {
        const index = next[kind]++;
        pos.set(x, y, z).multiplyScalar(s).applyAxisAngle(UP, yaw).add(base);
        euler.set(tilt, yawC + yaw, 0, 'YXZ');
        quat.setFromEuler(euler);
        scl.set(w * s, h * s, 1);
        m.compose(pos, quat, scl);
        mesh.setMatrixAt(index, m);
        mesh.setColorAt(index, tint);
        const centre = mesh.geometry.getAttribute('canopyCenter') as THREE.InstancedBufferAttribute;
        centre.setXYZ(index, canopy.x, canopy.y, canopy.z);
        slots.push({ mesh, index, matrix: m.clone() });
      };

      style.clusters.forEach(([cx, cy, cz, size], ci) => {
        const spin = seedAt(seed, ci + 10) * Math.PI;
        const mesh = cards[style.leaf];
        placeCard(mesh, style.leaf, cx, cy, cz, size, size, spin, 0);
        placeCard(mesh, style.leaf, cx, cy, cz, size, size, spin + Math.PI / 2, 0);
        placeCard(mesh, style.leaf, cx, cy + size * 0.1, cz, size * 0.95, size * 0.95, spin + seedAt(seed, ci + 20) * 3, Math.PI / 2 - 0.35);
      });
      style.strands.forEach(([sx, sy, sz, w, h], si) => {
        placeCard(cards.willow, 'willow', sx, sy, sz, w, h, Math.atan2(sx, sz) + seedAt(seed, si + 30) * 0.6, 0);
      });

      this.resources.set(`${tree.tile.x},${tree.tile.y}`, {
        slots,
        isDepleted: false,
        buildDepleted: () => this.buildStump(tree),
      });
    }

    for (const mesh of [trunks, cards.broad, cards.oak, cards.willow]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const centre = mesh.geometry.getAttribute('canopyCenter');
      if (centre) centre.needsUpdate = true;
    }
  }

  /** An instanced leaf-card mesh with a per-instance canopy centre for lighting. */
  private cardMesh(base: THREE.BufferGeometry, material: THREE.Material, count: number): THREE.InstancedMesh {
    const geo = base.clone();
    const n = Math.max(1, count);
    geo.setAttribute('canopyCenter', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.userData.noAO = true; // alpha-tested quads would smear the AO buffer
    this.root.add(mesh);
    return mesh;
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
        const color = new THREE.Color(1, 1, 1).offsetHSL(0, 0, (seedAt(seed, i + 12) - 0.5) * 0.12);
        const vein = rock.variant === 'tin' ? 0xd8dce4 : rock.variant === 'iron' ? 0xa0583a : 0xc98450;
        if (seedAt(seed, i + 15) < 0.5) color.lerp(new THREE.Color(vein), 0.55);
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
    const stump = new THREE.Mesh(this.geo.stump, this.mat.bark);
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
  return {
    trunk: makeTrunk(),
    stump: new THREE.CylinderGeometry(0.17, 0.21, 0.28, 6),
    card: makeCard(false),
    strand: makeCard(true),
    rocks: [0, 1, 2].map((i) => makeBoulder(i)),
  };
}

/** A tapered trunk with a root flare and three branches reaching into the canopy. */
function makeTrunk(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.19, 1.3, 7);
  trunk.translate(0, 0.65, 0);
  parts.push(trunk);
  const flare = new THREE.CylinderGeometry(0.19, 0.29, 0.16, 7);
  flare.translate(0, 0.08, 0);
  parts.push(flare);
  for (const [ang, lean] of [
    [0.4, 0.65],
    [2.5, 0.7],
    [4.4, 0.6],
  ]) {
    const b = new THREE.CylinderGeometry(0.035, 0.07, 0.75, 5);
    b.translate(0, 0.375, 0);
    b.rotateZ(lean);
    b.rotateY(ang);
    b.translate(Math.sin(ang) * 0.06, 1.05, Math.cos(ang) * 0.06);
    parts.push(b);
  }
  return mergeGeometries(parts);
}

/**
 * A leaf card: a unit quad drawn from both sides (two windings, so the
 * canopy shader's outward normals apply to either face). Strands hang from
 * their top edge; cluster cards pivot at their centre.
 */
function makeCard(topPivot: boolean): THREE.BufferGeometry {
  const front = new THREE.PlaneGeometry(1, 1);
  if (topPivot) front.translate(0, -0.5, 0);
  const back = front.clone();
  back.rotateY(Math.PI);
  return mergeGeometries([front, back]);
}

/**
 * A boulder: a dodecahedron with its vertices pushed around by noise so each
 * variant has lumps and creases, with the facets left hard so it lights like
 * a chunk of RuneScape scenery rather than a pebble.
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
  projectUvs(geo, 0.9);
  return geo;
}

function makeMaterials(leafTime: { value: number }, photos?: PhotoLibrary) {
  const bark = barkTextures();
  const rock = rockTextures();
  return {
    bark: applyPbr(new THREE.MeshStandardMaterial({ map: bark.albedo, normalMap: bark.normal, roughness: 0.95, envMapIntensity: 0.5 }), photos?.bark),
    rock: applyPbr(new THREE.MeshStandardMaterial({ map: rock.albedo, normalMap: rock.normal, roughness: 0.9, flatShading: true, envMapIntensity: 0.5 }), photos?.rock),
    rubble: applyPbr(new THREE.MeshStandardMaterial({ map: rock.albedo, normalMap: rock.normal, color: 0x8a8a8a, roughness: 0.95, flatShading: true }), photos?.rock),
    iron: new THREE.MeshStandardMaterial({ color: 0x555a63, roughness: 0.5, metalness: 0.7 }),
    // Well past white so the furnace mouth blooms.
    ember: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.4, 0.3) }),
    leafBroad: makeLeafMaterial(leafTexture('broad', 1), leafTime, false),
    leafOak: makeLeafMaterial(leafTexture('oak', 2), leafTime, false),
    leafWillow: makeLeafMaterial(leafTexture('willow', 3), leafTime, true),
  };
}

/**
 * The canopy material: alpha-tested leaf clusters whose lighting normals point
 * away from the tree's canopy centre (so the crown shades as one rounded mass)
 * and which sway in a vertex-shader breeze. Alpha-to-coverage feathers the
 * leaf edges against the MSAA buffer.
 */
function makeLeafMaterial(map: THREE.Texture, time: { value: number }, hanging: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.FrontSide,
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.uniforms.swayAtTop = { value: hanging ? 0 : 1 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 canopyCenter;\nuniform float time;\nuniform float swayAtTop;')
      .replace('#include <beginnormal_vertex>', LEAF_BEGIN_NORMAL)
      .replace('#include <defaultnormal_vertex>', LEAF_DEFAULT_NORMAL)
      .replace('#include <begin_vertex>', LEAF_BEGIN_VERTEX);
  };
  mat.customProgramCacheKey = () => `aeloria-leaf-${hanging ? 'hang' : 'card'}`;
  return mat;
}

const LEAF_BEGIN_NORMAL = /* glsl */ `
vec3 objectNormal = vec3(normal);
vec3 leafWorld = (instanceMatrix * vec4(position, 1.0)).xyz;
`;

const LEAF_DEFAULT_NORMAL = /* glsl */ `
vec3 transformedNormal = normalMatrix * normalize(leafWorld - canopyCenter + vec3(0.0, 0.35, 0.0));
`;

const LEAF_BEGIN_VERTEX = /* glsl */ `
vec3 transformed = vec3(position);
float swayWeight = mix(1.0 - uv.y, uv.y, swayAtTop) + 0.3;
vec3 sway = vec3(
  sin(time * 1.3 + leafWorld.x * 0.6 + leafWorld.z * 0.4),
  0.0,
  cos(time * 1.0 + leafWorld.z * 0.5 + leafWorld.x * 0.3)
) * 0.04 * swayWeight;
transformed += inverse(mat3(instanceMatrix)) * sway;
`;
