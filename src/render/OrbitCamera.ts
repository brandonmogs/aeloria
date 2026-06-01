import * as THREE from 'three';

/**
 * The classic RuneScape camera: it orbits a focus point (the player) at a fixed
 * distance, angled down toward the ground. Yaw and pitch are user-controlled
 * (middle/right-drag or the arrow keys) and the scroll wheel zooms. The camera
 * smoothly chases the player rather than snapping, which reads well against the
 * discrete tile movement underneath.
 */
export class OrbitCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly focus = new THREE.Vector3();

  private yaw = Math.PI * 0.25;
  private pitch = 0.95;
  private distance = 15;

  private readonly minPitch = 0.45;
  private readonly maxPitch = 1.35;
  private readonly minDistance = 6;
  private readonly maxDistance = 30;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly keys = new Set<string>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.bindEvents();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Smoothly ease the focus toward a world-space target (the player). */
  follow(target: THREE.Vector3): void {
    this.focus.lerp(target, 0.15);
  }

  /** Recompute the camera transform. Call once per rendered frame. */
  update(dt: number): void {
    const rot = 1.8 * dt;
    if (this.keys.has('ArrowLeft')) this.yaw += rot;
    if (this.keys.has('ArrowRight')) this.yaw -= rot;
    if (this.keys.has('ArrowUp')) this.pitch = clamp(this.pitch + rot, this.minPitch, this.maxPitch);
    if (this.keys.has('ArrowDown')) this.pitch = clamp(this.pitch - rot, this.minPitch, this.maxPitch);

    const horizontal = Math.cos(this.pitch) * this.distance;
    const height = Math.sin(this.pitch) * this.distance;
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * horizontal,
      this.focus.y + height,
      this.focus.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.focus);
  }

  private bindEvents(): void {
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('pointerdown', (e) => {
      // Middle or right button rotates, matching RuneScape conventions.
      if (e.button === 1 || e.button === 2) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    window.addEventListener('pointerup', () => {
      this.dragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.lastX) * 0.005;
      this.pitch = clamp(this.pitch - (e.clientY - this.lastY) * 0.005, this.minPitch, this.maxPitch);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.distance = clamp(
          this.distance + Math.sign(e.deltaY) * 1.5,
          this.minDistance,
          this.maxDistance,
        );
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => this.keys.add(e.key));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
