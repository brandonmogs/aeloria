import * as THREE from 'three';
import { World } from '../sim/World';

/**
 * Renders items lying on the ground as small billboarded icons that bob gently
 * above their tile — visible loot the way OSRS shows it, minus real item
 * models for now. Sprites are created and torn down as ground items come and
 * go; textures are cached per item icon so ten bones share one canvas.
 */
export class GroundItemView {
  private readonly sprites = new Map<number, THREE.Sprite>();
  private readonly textures = new Map<string, THREE.CanvasTexture>();
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
  ) {}

  sync(dt: number): void {
    this.clock += dt;

    for (const ground of this.world.groundItems.values()) {
      let sprite = this.sprites.get(ground.id);
      if (!sprite) {
        sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.textureFor(ground.item.icon ?? '📦'),
            transparent: true,
          }),
        );
        sprite.scale.set(0.42, 0.42, 1);
        this.sprites.set(ground.id, sprite);
        this.scene.add(sprite);
      }
      // Bob gently; a phase from the id keeps neighbouring drops out of sync.
      const bob = Math.sin(this.clock * 2.2 + ground.id * 1.7) * 0.045;
      sprite.position.set(ground.tile.x, 0.3 + bob, ground.tile.y);
    }

    for (const [id, sprite] of this.sprites) {
      if (!this.world.groundItems.has(id)) {
        this.scene.remove(sprite);
        sprite.material.dispose();
        this.sprites.delete(id);
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
      // A soft dark disc behind the glyph keeps it readable on bright grass.
      ctx.fillStyle = 'rgba(10, 12, 16, 0.35)';
      ctx.beginPath();
      ctx.arc(32, 34, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '40px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, 32, 34);
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(icon, tex);
    }
    return tex;
  }
}
