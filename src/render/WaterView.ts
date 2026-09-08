import * as THREE from 'three';
import { MoatLayout, WorldRect } from '../world/startingWorld';
import { WATER_LEVEL } from './Terrain';
import { buildBridge, makeCastleMaterials } from './castle';

/**
 * The castle moat, the OSRS way: a flat blue sheet with a scrolling two-tone
 * pattern, sitting in the basin the terrain scoops out for it. No reflections,
 * no refraction — one quad and one small animated texture.
 */
export class WaterView {
  private readonly texture: THREE.CanvasTexture;
  private clock = 0;

  constructor(scene: THREE.Scene, moat: MoatLayout) {
    this.texture = makeWaterTexture();
    const geo = buildRingGeometry(moat, 0.5); // overhang the banks so the waterline is the terrain's
    const mat = new THREE.MeshLambertMaterial({
      map: this.texture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
    });
    const water = new THREE.Mesh(geo, mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_LEVEL;
    water.receiveShadow = true;
    water.renderOrder = 1;
    scene.add(water);

    const b = moat.bridge;
    scene.add(buildBridge(makeCastleMaterials(), b.x0, b.x1, b.z0, b.z1));
  }

  update(dt: number): void {
    this.clock += dt;
    this.texture.offset.set(this.clock * 0.02, Math.sin(this.clock * 0.4) * 0.01 + this.clock * 0.012);
  }
}

/** A tiled blotchy pattern in two blues — the classic RuneScape water tile. */
function makeWaterTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#35608e';
  ctx.fillRect(0, 0, size, size);
  // Deterministic blotches so the tile edges match up when repeated.
  let s = 7;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const blot = (color: string, count: number, r: number): void => {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      for (const [ox, oy] of [
        [0, 0],
        [size, 0],
        [-size, 0],
        [0, size],
        [0, -size],
      ]) {
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, r * (0.7 + rnd() * 0.6), r * 0.45, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  blot('#3d6f9f', 16, 7);
  blot('#4a7fae', 12, 4.5);
  blot('#2f5680', 10, 5);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  return tex;
}

/** A flat rectangular ring (outer rect with the inner rect punched out), grown by `pad`. */
function buildRingGeometry(moat: MoatLayout, pad: number): THREE.ShapeGeometry {
  const shape = rectPath(grow(moat.outer, pad));
  shape.holes.push(rectPath(grow(moat.inner, -pad)));
  const geo = new THREE.ShapeGeometry(shape);
  // UVs in world units so the pattern tiles once per 1.5 tiles.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 1.5, pos.getY(i) / 1.5);
  return geo;
}

function grow(r: WorldRect, by: number): WorldRect {
  return { x0: r.x0 - by, z0: r.z0 - by, x1: r.x1 + by, z1: r.z1 + by };
}

/**
 * A rectangle in shape space. Shape Y maps to world -Z after the mesh's -90° X
 * rotation, so negate Z here to keep world orientation correct.
 */
function rectPath(r: WorldRect): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(r.x0, -r.z0);
  s.lineTo(r.x1, -r.z0);
  s.lineTo(r.x1, -r.z1);
  s.lineTo(r.x0, -r.z1);
  s.closePath();
  return s;
}

