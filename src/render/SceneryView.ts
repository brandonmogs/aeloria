import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { Prop } from '../sim/Scenery';

/**
 * Renders the static, decorative world: trees, boulders, and the castle. Each
 * {@link Prop} from the world builder becomes a small mesh group placed on its
 * tile. Geometries and materials are created once and shared across every prop
 * of a kind, so a whole forest costs almost nothing beyond its draw calls.
 *
 * Shapes are kept smooth and rounded rather than faceted — stone uses beveled
 * rounded boxes so edges catch a highlight, boulders are noise-displaced spheres
 * with recomputed normals, and foliage is subdivided. With the scene's filmic
 * tone mapping and image-based lighting that reads as "carved" rather than
 * "blocky", while staying cheap by sharing geometry across every prop of a kind.
 */
export class SceneryView {
  private readonly root = new THREE.Group();
  private readonly geo = makeGeometries();
  private readonly mat = makeMaterials();

  constructor(scene: THREE.Scene, props: ReadonlyArray<Prop>) {
    for (const prop of props) {
      const obj = this.build(prop);
      if (obj) {
        obj.position.set(prop.tile.x, 0, prop.tile.y);
        this.root.add(obj);
      }
    }
    scene.add(this.root);
  }

  private build(prop: Prop): THREE.Object3D | null {
    switch (prop.kind) {
      case 'tree':
        return this.buildTree(prop.seed);
      case 'rock':
        return this.buildRock(prop.seed);
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

  private buildTree(seed: number): THREE.Object3D {
    const g = new THREE.Group();

    const trunk = new THREE.Mesh(this.geo.trunk, this.mat.bark);
    trunk.position.y = 0.55;
    g.add(this.shadowed(trunk));

    // A few overlapping blobs make a fuller canopy than a single sphere. Tint
    // and size drift with the seed so no two trees look stamped from the same die.
    const leaf = seed > 0.5 ? this.mat.leafA : this.mat.leafB;
    const base = 1.2 + seed * 0.4;
    const blobs: ReadonlyArray<readonly [number, number, number, number]> = [
      [0, base, 0, 0.62],
      [0.28, base + 0.32, 0.12, 0.42],
      [-0.24, base + 0.28, -0.16, 0.4],
      [0.05, base + 0.6, 0, 0.34],
    ];
    for (const [x, y, z, r] of blobs) {
      const blob = new THREE.Mesh(this.geo.canopy, leaf);
      blob.scale.setScalar(r);
      blob.position.set(x, y, z);
      g.add(this.shadowed(blob));
    }

    g.rotation.y = seed * Math.PI * 2;
    g.scale.setScalar(0.85 + seed * 0.35);
    return g;
  }

  private buildRock(seed: number): THREE.Object3D {
    const g = new THREE.Group();
    const count = 2 + Math.floor(seed * 3);
    for (let i = 0; i < count; i++) {
      const s = seedAt(seed, i);
      const variant = this.geo.rocks[Math.floor(seedAt(seed, i + 3) * this.geo.rocks.length)];
      const rock = new THREE.Mesh(variant, this.mat.rock);
      const size = 0.24 + s * 0.32;
      // Sink each boulder a little into the ground so it doesn't look like it's
      // resting on a seam, and squash it slightly for a settled, weighty stance.
      rock.scale.set(size, size * (0.7 + s * 0.35), size);
      rock.position.set((s - 0.5) * 0.6, size * 0.32, (seedAt(seed, i + 9) - 0.5) * 0.6);
      rock.rotation.set(s * 3, s * 6, s * 2);
      g.add(this.shadowed(rock));
    }
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

/** Deterministic sub-seed in [0, 1) so a prop's parts vary without randomness. */
function seedAt(seed: number, i: number): number {
  const v = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function makeGeometries() {
  return {
    trunk: new THREE.CylinderGeometry(0.13, 0.2, 1.1, 12),
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
    stone,
    roof: new THREE.MeshStandardMaterial({ color: 0x873f3f, roughness: 0.6, envMapIntensity: 0.7 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xe8c66a, roughness: 0.25, metalness: 0.85, envMapIntensity: 1 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xb33b3b, roughness: 0.6, side: THREE.DoubleSide, envMapIntensity: 0.5 }),
  };
}
