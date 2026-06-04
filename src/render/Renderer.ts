import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OrbitCamera } from './OrbitCamera';

/** Sun placement in the sky, in degrees. Drives the light, sky, and IBL together. */
const SUN_ELEVATION = 34;
const SUN_AZIMUTH = 138;

/**
 * Owns the WebGL context, scene, lighting, camera, and the HD post-processing
 * pipeline. Views (tiles, entities) add objects to `scene`; the game loop calls
 * {@link render} every frame.
 *
 * The look is built the way RuneLite's 117 HD builds its: a physically-based
 * atmospheric {@link Sky} with a real sun, which also seeds the image-based
 * lighting so every surface is lit by the same sky it sits under; a warm
 * directional sun with soft shadows; and a composited frame — SSAO for contact
 * shadows in the creases, a touch of bloom on the bright sun and metal, ACES
 * tone mapping, and SMAA edges — rendered through an HDR (half-float) buffer so
 * highlights have headroom instead of clipping. That stack is what pushes it
 * past "lit geometry" into something that reads as graded and atmospheric.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: OrbitCamera;
  /** Unit direction to the sun; shared so water/highlights match the sky. */
  readonly sunDirection = new THREE.Vector3();
  private readonly renderer: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private ssao!: SSAOPass;
  private bloom!: UnrealBloomPass;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // applied at the OutputPass
    this.renderer.toneMappingExposure = 1.0;

    // Horizon-tinted fog blends the ground into the sky in the distance.
    this.scene.fog = new THREE.Fog(0xbcd6ea, 46, 120);

    this.camera = new OrbitCamera(canvas);

    const sunDir = this.setupSky();
    this.setupEnvironment();
    this.setupLights(sunDir);
    this.setupPostFX();
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  render(): void {
    this.composer.render();
  }

  /** Build the atmospheric sky dome and return the unit direction to the sun. */
  private setupSky(): THREE.Vector3 {
    const sky = new Sky();
    sky.scale.setScalar(10000);
    this.scene.add(sky);

    const u = sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.7;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;

    const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
    const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sunDir);
    this.sunDirection.copy(sunDir);
    return sunDir;
  }

  /**
   * Prefilter the current scene (just the sky at this point) into an environment
   * map, so every PBR surface picks up ambient and reflections from the same sky
   * it stands under — the cheap secret behind cohesive outdoor lighting.
   */
  private setupEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(this.scene, 0.04).texture;
    pmrem.dispose();
  }

  private setupLights(sunDir: THREE.Vector3): void {
    // A gentle sky/ground tint on top of the image-based fill.
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x40462f, 0.35));

    const sun = new THREE.DirectionalLight(0xfff1d4, 2.7);
    sun.position.copy(sunDir).multiplyScalar(60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4; // softens the PCF penumbra
    const extent = 54;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    this.scene.add(sun);
    this.scene.add(sun.target); // target defaults to origin, which frames the map
  }

  /** Wire the HDR composite: scene → SSAO → bloom → tone-mapped output → SMAA. */
  private setupPostFX(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    const hdrTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4, // MSAA on the base render
    });
    this.composer = new EffectComposer(this.renderer, hdrTarget);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());

    this.composer.addPass(new RenderPass(this.scene, this.camera.camera));

    this.ssao = new SSAOPass(this.scene, this.camera.camera, size.x, size.y);
    this.ssao.kernelRadius = 0.7;
    this.ssao.minDistance = 0.004;
    this.ssao.maxDistance = 0.1;
    this.composer.addPass(this.ssao);

    // Subtle: only the bright sun and metal glints glow, not the whole frame.
    this.bloom = new UnrealBloomPass(size, 0.22, 0.5, 0.9);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass()); // ACES tone map + sRGB encode
    this.composer.addPass(new SMAAPass(size.x, size.y)); // clean edges on the final image
  }

  private handleResize = (): void => {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.ssao.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.setAspect(w / h);
  };
}
