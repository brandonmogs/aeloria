import * as THREE from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { TileMap } from '../sim/TileMap';
import { Tile } from '../sim/coords';

/**
 * Renders the static *ground*: the grass plane and the tile grid overlay. Solid
 * world props (trees, rocks, the castle) are drawn by {@link SceneryView}; this
 * class also owns two bits of interactive feedback — the tile the mouse is
 * hovering and the fading marker that appears where you click to walk, echoing
 * RuneScape's flag/X.
 */
export class TileGridView {
  private readonly hover: THREE.Mesh;
  private readonly marker: THREE.Mesh;
  private markerLife = 0;

  constructor(scene: THREE.Scene, map: TileMap) {
    scene.add(this.buildGround(map));
    scene.add(this.buildGrid(map));

    this.hover = this.buildQuad(0x9fe8ff, 0.3);
    this.hover.visible = false;
    scene.add(this.hover);

    this.marker = this.buildQuad(0xffd34d, 0.9);
    this.marker.visible = false;
    scene.add(this.marker);
  }

  /** Pop the click marker at a tile; it fades over roughly one tick. */
  showClickMarker(t: Tile): void {
    this.marker.position.set(t.x, 0.02, t.y);
    this.marker.visible = true;
    this.markerLife = 1;
  }

  update(hoverTile: Tile | null, dt: number): void {
    if (hoverTile) {
      this.hover.visible = true;
      this.hover.position.set(hoverTile.x, 0.02, hoverTile.y);
    } else {
      this.hover.visible = false;
    }

    if (this.markerLife > 0) {
      this.markerLife = Math.max(0, this.markerLife - dt / 0.6);
      const mat = this.marker.material as THREE.MeshBasicMaterial;
      mat.opacity = this.markerLife;
      const s = 0.6 + this.markerLife * 0.7;
      this.marker.scale.set(s, s, s);
      this.marker.rotation.y += dt * 4;
      this.marker.visible = this.markerLife > 0;
    }
  }

  private buildGround(map: TileMap): THREE.Mesh {
    // Subdivided so we can tint it per-vertex; it stays perfectly flat (y = 0)
    // so the click-to-walk raycast against the ground plane is still exact.
    const segs = Math.max(map.width, map.height);
    const geo = new THREE.PlaneGeometry(map.width, map.height, segs, segs);
    geo.rotateX(-Math.PI / 2);

    // Drift between a few grass tones with simplex noise, with rarer dirt
    // patches, so the clearing reads as living turf rather than a flat sheet.
    const noise = new SimplexNoise();
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const dark = new THREE.Color(0x35512f);
    const light = new THREE.Color(0x5a7a44);
    const dirt = new THREE.Color(0x6b5536);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const grass = noise.noise(x * 0.12, z * 0.12) * 0.5 + 0.5;
      const patch = noise.noise(x * 0.05 + 50, z * 0.05 - 50) * 0.5 + 0.5;
      c.copy(dark).lerp(light, grass);
      if (patch > 0.82) c.lerp(dirt, (patch - 0.82) / 0.18);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    // Tile (x, y) is centred on integer coords, so the plane is offset by half.
    mesh.position.set(map.width / 2 - 0.5, 0, map.height / 2 - 0.5);
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildGrid(map: TileMap): THREE.LineSegments {
    const pts: number[] = [];
    const y = 0.012;
    for (let x = 0; x <= map.width; x++) {
      pts.push(x - 0.5, y, -0.5, x - 0.5, y, map.height - 0.5);
    }
    for (let z = 0; z <= map.height; z++) {
      pts.push(-0.5, y, z - 0.5, map.width - 0.5, y, z - 0.5);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x223d27, transparent: true, opacity: 0.18 });
    return new THREE.LineSegments(geo, mat);
  }

  private buildQuad(color: number, opacity: number): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(0.94, 0.94);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    return mesh;
  }
}
