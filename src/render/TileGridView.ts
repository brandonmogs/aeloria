import * as THREE from 'three';
import { Tile } from '../sim/coords';
import { Terrain } from './Terrain';

/**
 * The click marker: RuneScape's yellow X where you clicked to walk, red for an
 * interaction, shrinking away over roughly one tick. The ground itself is the
 * {@link Terrain}; solid props are drawn by SceneryView.
 */
export class TileGridView {
  private readonly marker: THREE.Mesh;
  private readonly walkTex: THREE.CanvasTexture;
  private readonly interactTex: THREE.CanvasTexture;
  private markerLife = 0;

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    this.walkTex = makeCrossTexture('#f3e83a');
    this.interactTex = makeCrossTexture('#ff3b2f');
    const geo = new THREE.PlaneGeometry(0.72, 0.72);
    geo.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: this.walkTex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.marker.renderOrder = 6;
    this.marker.visible = false;
    scene.add(this.marker);
  }

  /** Pop the X at a tile. */
  showClickMarker(t: Tile, kind: 'walk' | 'interact' = 'walk'): void {
    const mat = this.marker.material as THREE.MeshBasicMaterial;
    mat.map = kind === 'walk' ? this.walkTex : this.interactTex;
    this.marker.position.set(t.x, this.terrain.tileHeight(t) + 0.03, t.y);
    this.marker.visible = true;
    this.markerLife = 1;
  }

  update(_hoverTile: Tile | null, dt: number): void {
    if (this.markerLife > 0) {
      this.markerLife = Math.max(0, this.markerLife - dt / 0.55);
      const mat = this.marker.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(1, this.markerLife * 2);
      const s = 0.55 + this.markerLife * 0.45;
      this.marker.scale.set(s, 1, s);
      this.marker.visible = this.markerLife > 0;
    }
  }
}

/** A chunky X with a dark outline, like the OSRS walk marker. */
function makeCrossTexture(color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = 'square';
  const draw = (w: number, style: string): void => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(12, 12);
    ctx.lineTo(52, 52);
    ctx.moveTo(52, 12);
    ctx.lineTo(12, 52);
    ctx.stroke();
  };
  draw(13, 'rgba(0,0,0,0.85)');
  draw(7, color);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
