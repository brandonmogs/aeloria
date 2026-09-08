import * as THREE from 'three';
import { World } from '../sim/World';
import { itemDef } from '../sim/items';
import { Terrain } from './Terrain';

/**
 * Renders items lying on the ground as small icons laid flat on the tile —
 * visible loot the way OSRS shows it, minus real item models for now. Meshes
 * are created and torn down as ground items come and go; textures are cached
 * per item icon so ten bones share one canvas.
 */
export class GroundItemView {
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly textures = new Map<string, THREE.CanvasTexture>();
  private readonly geo = new THREE.PlaneGeometry(0.52, 0.52);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly terrain: Terrain,
  ) {
    this.geo.rotateX(-Math.PI / 2);
  }

  sync(_dt: number): void {
    for (const ground of this.world.groundItems.values()) {
      let mesh = this.meshes.get(ground.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          this.geo,
          new THREE.MeshBasicMaterial({
            map: this.textureFor(itemDef(ground.item.id).icon),
            transparent: true,
            depthWrite: false,
          }),
        );
        mesh.renderOrder = 2;
        // A little yaw from the id so a pile of drops doesn't line up.
        mesh.rotation.y = (ground.id * 0.9) % (Math.PI * 2);
        mesh.position.set(ground.tile.x, this.terrain.tileHeight(ground.tile) + 0.04, ground.tile.y);
        this.meshes.set(ground.id, mesh);
        this.scene.add(mesh);
      }
    }

    for (const [id, mesh] of this.meshes) {
      if (!this.world.groundItems.has(id)) {
        this.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        this.meshes.delete(id);
      }
    }
  }

  private textureFor(icon: string): THREE.CanvasTexture {
    let tex = this.textures.get(icon);
    if (!tex) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.font = '44px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // A dark outline keeps the glyph readable on bright grass.
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 4;
      ctx.fillText(icon, 32, 34);
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(icon, tex);
    }
    return tex;
  }
}
