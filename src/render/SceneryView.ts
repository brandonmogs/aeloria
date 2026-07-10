import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Prop } from '../sim/Scenery';
import { World } from '../sim/World';

/** Where a gatherable prop's instances live, so the sim can hide/show them. */
interface ResourceVisual {
  /** Instanced slots making up the intact prop (trunk + canopy, or boulders). */
  slots: Array<{ mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }>;
  /** Lazily-built depleted stand-in (stump / rubble). */
  depleted?: THREE.Object3D;
  buildDepleted: () => THREE.Object3D;
  isDepleted: boolean;
}

/**
 * Renders the static, decorative world: trees, boulders, and the castle.
 *
 * Draw-call budget is the whole design here. The castle — hundreds of wall
 * blocks and merlons — is baked into ONE merged mesh per material. Trees and
 * rocks, which must be hidden individually when the sim depletes them, are
 * drawn with a handful of InstancedMeshes (one per geometry+material pair);
 * a depleted node just zeroes its instance matrices and shows a small stump
 * or rubble mesh instead. The result is a scene that renders in tens of draw
 * calls rather than thousands, which matters fourfold once shadows, water
 * reflections, and SSAO each re-render it.
 */
export class SceneryView {
  private readonly root = new THREE.Group();
  private readonly geo = makeGeometries();
  private readonly mat = makeMaterials();
  /** Gatherable props keyed by "x,y". */
  private readonly resources = new Map<string, ResourceVisual>();
  private readonly zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene, props: ReadonlyArray<Prop>) {
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

  // --- Castle: bake everything into one mesh per material -------------------

  private buildCastleMerged(props: ReadonlyArray<Prop>): void {
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const collect = (group: THREE.Object3D): void => {
      group.updateMatrixWorld(true);
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          // Normalize to non-indexed: merge requires all-or-none indexing.
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
      obj.position.set(prop.tile.x, 0, prop.tile.y);
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
      default:
        return null;
    }
  }

  // --- Trees: three instanced meshes for the whole forest -------------------

  private buildTreesInstanced(trees: ReadonlyArray<Prop>): void {
    // The same canopy blob layout buildTree used, kept verbatim so the look
    // doesn't change: [x, y-above-base, z, radius].
    const blobLayout: ReadonlyArray<readonly [number, number, number, number]> = [
      [0, 0, 0, 0.62],
      [0.28, 0.32, 0.12, 0.42],
      [-0.24, 0.28, -0.16, 0.4],
      [0.05, 0.6, 0, 0.34],
    ];

    const treesA = trees.filter((t) => t.seed > 0.5);
    const treesB = trees.filter((t) => t.seed <= 0.5);

    const trunks = this.instanced(this.geo.trunk, this.mat.bark, trees.length);
    const canopyA = this.instanced(this.geo.canopy, this.mat.leafA, treesA.length * blobLayout.length);
    const canopyB = this.instanced(this.geo.canopy, this.mat.leafB, treesB.length * blobLayout.length);

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const m = new THREE.Matrix4();

    let trunkI = 0;
    const canopyI = { A: 0, B: 0 };

    for (const tree of trees) {
      const seed = tree.seed;
      const s = 0.85 + seed * 0.35; // whole-tree scale
      const yaw = seed * Math.PI * 2;
      const slots: ResourceVisual['slots'] = [];

      // Trunk: local (0, 0.55, 0), uniform scale, yaw irrelevant but applied.
      quat.setFromAxisAngle(UP, yaw);
      pos.set(tree.tile.x, 0.55 * s, tree.tile.y);
      scl.setScalar(s);
      m.compose(pos, quat, scl);
      trunks.setMatrixAt(trunkI, m);
      slots.push({ mesh: trunks, index: trunkI, matrix: m.clone() });
      trunkI++;

      const isA = seed > 0.5;
      const canopy = isA ? canopyA : canopyB;
      const base = 1.2 + seed * 0.4;
      for (const [bx, by, bz, r] of blobLayout) {
        // Rotate the blob offset by the tree's yaw, scale by the tree scale.
        pos.set(bx, base + by, bz).multiplyScalar(s).applyQuaternion(quat);
        pos.x += tree.tile.x;
        pos.z += tree.tile.y;
        scl.setScalar(r * s);
        m.compose(pos, quat, scl);
        const idx = isA ? canopyI.A++ : canopyI.B++;
        canopy.setMatrixAt(idx, m);
        slots.push({ mesh: canopy, index: idx, matrix: m.clone() });
      }

      this.resources.set(`${tree.tile.x},${tree.tile.y}`, {
        slots,
        isDepleted: false,
        buildDepleted: () => this.buildStump(tree),
      });
    }

    for (const mesh of [trunks, canopyA, canopyB]) mesh.instanceMatrix.needsUpdate = true;
  }

  // --- Rocks: one instanced mesh per boulder variant -------------------------

  private buildRocksInstanced(rocks: ReadonlyArray<Prop>): void {
    // First pass: count instances per variant so the meshes can be sized.
    interface Boulder {
      variant: number;
      matrix: THREE.Matrix4;
      tileKey: string;
    }
    const boulders: Boulder[] = [];

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const euler = new THREE.Euler();

    for (const rock of rocks) {
      const seed = rock.seed;
      const count = 2 + Math.floor(seed * 3);
      for (let i = 0; i < count; i++) {
        const s = seedAt(seed, i);
        const variant = Math.floor(seedAt(seed, i + 3) * this.geo.rocks.length);
        const size = 0.24 + s * 0.32;
        pos.set(rock.tile.x + (s - 0.5) * 0.6, size * 0.32, rock.tile.y + (seedAt(seed, i + 9) - 0.5) * 0.6);
        scl.set(size, size * (0.7 + s * 0.35), size);
        euler.set(s * 3, s * 6, s * 2);
        quat.setFromEuler(euler);
        boulders.push({
          variant,
          matrix: new THREE.Matrix4().compose(pos, quat, scl),
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

    for (const mesh of perVariant) mesh.instanceMatrix.needsUpdate = true;
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
    g.add(this.shadowed(stump));
    g.rotation.y = tree.seed * Math.PI * 2;
    g.position.set(tree.tile.x, 0, tree.tile.y);
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
      g.add(this.shadowed(rock));
    }
    g.position.set(x, 0, y);
    return g;
  }

  private buildWall(): THREE.Object3D {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.geo.wall, this.mat.stone);
    body.position.y = 1.1;
    g.add(this.shadowed(body));
    this.addBattlements(g, 2.2, 0.46);
    return g;
  }

  private buildTower(): THREE.Object3D {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(this.geo.tower, this.mat.stone);
    shaft.position.y = 1.55;
    g.add(this.shadowed(shaft));

    // Crenellated ring around the top.
    const ring = 8;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2;
      const merlon = new THREE.Mesh(this.geo.merlon, this.mat.stone);
      merlon.position.set(Math.cos(a) * 0.62, 3.2, Math.sin(a) * 0.62);
      g.add(merlon);
    }

    const roof = new THREE.Mesh(this.geo.roof, this.mat.roof);
    roof.position.y = 3.9;
    g.add(this.shadowed(roof));

    const finial = new THREE.Mesh(this.geo.finial, this.mat.gold);
    finial.position.y = 4.7;
    g.add(finial);
    return g;
  }

  private buildGate(): THREE.Object3D {
    // The gate tiles stay walkable; this is just the arch overhead. Side jambs
    // sit on the tile edges so they don't crowd whoever walks through.
    const g = new THREE.Group();
    for (const side of [-0.5, 0.5]) {
      const jamb = new THREE.Mesh(this.geo.gateJamb, this.mat.stone);
      jamb.position.set(side, 1.4, 0);
      g.add(this.shadowed(jamb));
    }
    const lintel = new THREE.Mesh(this.geo.gateLintel, this.mat.stone);
    lintel.position.set(0, 2.9, 0);
    g.add(this.shadowed(lintel));
    return g;
  }

  private buildKeep(): THREE.Object3D {
    // One mesh spanning the 3x3 footprint at the heart of the castle.
    const g = new THREE.Group();
    const base = new THREE.Mesh(this.geo.keepBase, this.mat.stone);
    base.position.y = 1.4;
    g.add(this.shadowed(base));
    this.addBattlements(g, 2.8, 1.3, 0.65);

    const spire = new THREE.Mesh(this.geo.keepSpire, this.mat.stone);
    spire.position.y = 3.7;
    g.add(this.shadowed(spire));

    const roof = new THREE.Mesh(this.geo.keepRoof, this.mat.roof);
    roof.position.y = 5.2;
    g.add(this.shadowed(roof));

    // A pennant on top, just for the silhouette.
    const pole = new THREE.Mesh(this.geo.finial, this.mat.bark);
    pole.scale.set(0.5, 1.6, 0.5);
    pole.position.y = 6.1;
    g.add(pole);
    const flag = new THREE.Mesh(this.geo.flag, this.mat.flag);
    flag.position.set(0.22, 6.35, 0);
    g.add(flag);
    return g;
  }

  /** Lay a ring of merlons (crenellation teeth) around a square top edge. */
  private addBattlements(g: THREE.Group, topY: number, half: number, gap = 0.32): void {
    const step = gap * 2;
    for (let t = -half + gap / 2; t <= half; t += step) {
      for (const [x, z] of [
        [t, -half],
        [t, half],
        [-half, t],
        [half, t],
      ] as const) {
        const merlon = new THREE.Mesh(this.geo.merlon, this.mat.stone);
        merlon.position.set(x, topY + 0.18, z);
        g.add(merlon);
      }
    }
  }

  private shadowed<T extends THREE.Mesh>(mesh: T): T {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** Deterministic sub-seed in [0, 1) so a prop's parts vary without randomness. */
function seedAt(seed: number, i: number): number {
  const v = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function makeGeometries() {
  return {
    trunk: new THREE.CylinderGeometry(0.13, 0.2, 1.1, 12),
    stump: new THREE.CylinderGeometry(0.17, 0.21, 0.28, 12),
    canopy: new THREE.IcosahedronGeometry(1, 2),
    rocks: [0, 1, 2, 3].map((i) => makeBoulder(i)),
    wall: new RoundedBoxGeometry(1.0, 2.2, 1.0, 4, 0.07),
    tower: new THREE.CylinderGeometry(0.62, 0.72, 3.1, 24),
    roof: new THREE.ConeGeometry(0.82, 1.4, 24),
    finial: new THREE.CylinderGeometry(0.05, 0.05, 0.6, 10),
    merlon: new RoundedBoxGeometry(0.26, 0.36, 0.26, 3, 0.05),
    gateJamb: new RoundedBoxGeometry(0.34, 2.8, 1.0, 4, 0.06),
    gateLintel: new RoundedBoxGeometry(1.34, 0.7, 1.0, 4, 0.08),
    keepBase: new RoundedBoxGeometry(2.8, 2.8, 2.8, 6, 0.12),
    keepSpire: new RoundedBoxGeometry(1.4, 2.8, 1.4, 5, 0.1),
    keepRoof: new THREE.ConeGeometry(1.2, 1.9, 24),
    flag: new THREE.BoxGeometry(0.5, 0.34, 0.04),
  };
}

/**
 * A boulder: a subdivided sphere pushed around by simplex noise so each variant
 * has natural lumps and creases. Normals are recomputed so it lights smoothly
 * rather than faceted. Four variants are baked and shared across every rock.
 */
function makeBoulder(variant: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const noise = new SimplexNoise();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const off = variant * 13.7;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      noise.noise3d(v.x * 1.4 + off, v.y * 1.4, v.z * 1.4) * 0.28 +
      noise.noise3d(v.x * 3.1, v.y * 3.1, v.z * 3.1 + off) * 0.1;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeMaterials() {
  const stone = new THREE.MeshStandardMaterial({ color: 0xb4ad9e, roughness: 0.82, metalness: 0.05, envMapIntensity: 0.6 });
  return {
    bark: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.92, envMapIntensity: 0.4 }),
    leafA: new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.85, envMapIntensity: 0.4 }),
    leafB: new THREE.MeshStandardMaterial({ color: 0x559449, roughness: 0.85, envMapIntensity: 0.4 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x868c96, roughness: 0.95, envMapIntensity: 0.5 }),
    rubble: new THREE.MeshStandardMaterial({ color: 0x5c6069, roughness: 0.98, envMapIntensity: 0.4 }),
    stone,
    roof: new THREE.MeshStandardMaterial({ color: 0x873f3f, roughness: 0.6, envMapIntensity: 0.7 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xe8c66a, roughness: 0.25, metalness: 0.85, envMapIntensity: 1 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xb33b3b, roughness: 0.6, side: THREE.DoubleSide, envMapIntensity: 0.5 }),
  };
}
