import * as THREE from 'three';
import { OrbitCamera } from './OrbitCamera';

/**
 * Owns the WebGL context, scene, lighting, and camera. Views (tiles, entities)
 * add their objects to `scene`; the game loop calls {@link render} every frame.
 * Lighting is a warm directional "sun" with soft shadows plus a cool hemisphere
 * fill — enough to give the HD-but-readable look we're after without a heavy
 * post-processing stack yet.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: OrbitCamera;
  private readonly renderer: THREE.WebGLRenderer;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x141a24);
    this.scene.fog = new THREE.Fog(0x141a24, 34, 72);

    this.camera = new OrbitCamera(canvas);
    this.setupLights();
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera.camera);
  }

  private setupLights(): void {
    const fill = new THREE.HemisphereLight(0xcfe8ff, 0x32302a, 0.9);
    this.scene.add(fill);

    const sun = new THREE.DirectionalLight(0xfff2d6, 1.7);
    sun.position.set(18, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    const extent = 42;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    this.scene.add(sun);
  }

  private handleResize = (): void => {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.setAspect(w / h);
  };
}
