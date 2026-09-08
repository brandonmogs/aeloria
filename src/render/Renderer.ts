import * as THREE from 'three';
import { OrbitCamera } from './OrbitCamera';

/** The colour of the sky and of the distance the world fades into. */
const SKY = 0x8fbde6;

/**
 * Owns the WebGL context, scene, lighting, and camera. Views (terrain,
 * entities, scenery) add objects to `scene`; the game loop calls
 * {@link render} every frame.
 *
 * The look is deliberately Old School: a single warm sun with plain shadows,
 * a sky-tinted hemisphere fill, flat-shaded Lambert materials, no
 * post-processing, no tone mapping, and a flat sky colour with distance fog.
 * One scene pass plus one shadow pass per frame is the entire budget — that
 * keeps the GPU cool and the colours as saturated as the 2007 originals.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: OrbitCamera;
  /** Unit direction to the sun; shared so glints and highlights agree. */
  readonly sunDirection = new THREE.Vector3(0.45, 0.8, 0.4).normalize();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sun: THREE.DirectionalLight;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    // OSRS is a crisp, slightly pixelly game; 1.5× is plenty on HiDPI screens
    // and keeps the fill-rate cost sane on 4K monitors.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.info.autoReset = false;

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 44, 105);

    this.camera = new OrbitCamera(canvas);

    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4c6a34, 0.85));
    this.sun = new THREE.DirectionalLight(0xfff3dc, 1.35);
    this.sun.position.copy(this.sunDirection).multiplyScalar(90);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.radius = 1;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 220;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  /** Centre the sun's shadow frustum on the map so every tile gets shadows. */
  frameShadows(centerX: number, centerZ: number, halfExtent: number): void {
    this.sun.target.position.set(centerX, 0, centerZ);
    this.sun.position.copy(this.sunDirection).multiplyScalar(90).add(this.sun.target.position);
    const cam = this.sun.shadow.camera;
    cam.left = -halfExtent;
    cam.right = halfExtent;
    cam.top = halfExtent;
    cam.bottom = -halfExtent;
    cam.updateProjectionMatrix();
  }

  render(): void {
    // Manual reset so the counters reflect a full frame when read between frames.
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera.camera);
  }

  /** Live WebGL counters (draw calls, triangles) for perf diagnostics. */
  get stats(): { calls: number; triangles: number } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  private handleResize = (): void => {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.setAspect(w / h);
  };
}
