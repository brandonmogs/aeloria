import * as THREE from 'three';
import { TileMap } from '../sim/TileMap';
import { Tile } from '../sim/coords';

/**
 * Renders the static world: the ground plane, the tile grid overlay, and a mesh
 * for every blocked tile. It also owns two bits of interactive feedback — the
 * tile the mouse is hovering and the fading marker that appears where you click
 * to walk, echoing RuneScape's flag/X.
 */
export class TileGridView {
  private readonly hover: THREE.Mesh;
  private readonly marker: THREE.Mesh;
  private markerLife = 0;

  constructor(scene: THREE.Scene, map: TileMap) {
    scene.add(this.buildGround(map));
    scene.add(this.buildGrid(map));
    scene.add(this.buildObstacles(map));

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
    const geo = new THREE.PlaneGeometry(map.width, map.height);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3c5a3a, roughness: 1 });
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
    const mat = new THREE.LineBasicMaterial({ color: 0x294a2e, transparent: true, opacity: 0.5 });
    return new THREE.LineSegments(geo, mat);
  }

  private buildObstacles(map: TileMap): THREE.Group {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(0.92, 1.0, 0.92);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b6f78, roughness: 0.9 });
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!map.isBlocked(x, y)) continue;
        const block = new THREE.Mesh(geo, mat);
        block.position.set(x, 0.5, y);
        block.castShadow = true;
        block.receiveShadow = true;
        group.add(block);
      }
    }
    return group;
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
