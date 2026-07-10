import * as THREE from 'three';
import { OrbitCamera } from '../render/OrbitCamera';
import { Tile, tile } from '../sim/coords';

/**
 * Translates mouse input into the tile space the simulation understands. A left
 * click is ray-cast onto the ground plane to find the target tile, which is
 * handed off as a movement intent. This is deliberately the *only* place raw
 * input becomes a game command — the same seam where a networked client would
 * send the command to the server instead of applying it locally.
 */
export class InputController {
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly hit = new THREE.Vector3();

  /** The tile currently under the cursor, or null if the cursor is off-world. */
  hoverTile: Tile | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: OrbitCamera,
    private readonly onMoveTo: (target: Tile) => void,
    private readonly onContextMenu?: (clientX: number, clientY: number, tile: Tile) => void,
  ) {
    this.bind();
  }

  private bind(): void {
    this.canvas.addEventListener('pointermove', (e) => {
      this.hoverTile = this.tileAt(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // left click acts; middle rotates; right menus
      const target = this.tileAt(e.clientX, e.clientY);
      if (target) this.onMoveTo(target);
    });
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const target = this.tileAt(e.clientX, e.clientY);
      if (target) this.onContextMenu?.(e.clientX, e.clientY, target);
    });
  }

  private tileAt(clientX: number, clientY: number): Tile | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera.camera);
    const point = this.raycaster.ray.intersectPlane(this.groundPlane, this.hit);
    if (!point) return null;
    return tile(Math.round(point.x), Math.round(point.z));
  }
}
