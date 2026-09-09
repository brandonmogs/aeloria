import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OrbitCamera } from './OrbitCamera';
import { LightPool } from './LightPool';

/**
 * Unit vector toward the sun. It hangs in the north-western sky about 46° up,
 * so a north-facing view (the OSRS default) is front-lit and shadows fall away
 * to the south-east, the quadrant Old School's fixed light has always come from.
 */
export const SUN_DIRECTION = new THREE.Vector3(-0.6, 0.85, 0.55).normalize();

/** Half-width of the block of world the shadow map covers, centred ahead of the camera. */
const SHADOW_HALF_EXTENT = 34;
const SHADOW_MAP_SIZE = 4096;
/** Distance fades into this: the sky's own horizon tint. */
const FOG_COLOR = 0xc7d9e9;

export interface RenderStats {
  calls: number;
  triangles: number;
  /** CPU milliseconds spent submitting the last frame. */
  frameMs: number;
}

/**
 * The final grade, in the spirit of 117 HD's saturation/contrast/brightness
 * sliders: a little extra saturation and contrast so the greens and reds pop
 * the way the 2007 palette did, a soft vignette, and a dither that kills the
 * banding tone-mapped skies are prone to.
 */
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 1.08 },
    contrast: { value: 1.04 },
    brightness: { value: 1.0 },
    vignette: { value: 0.26 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float brightness;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(luma), c.rgb, saturation);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      c.rgb *= brightness;
      float d = length((vUv - 0.5) * vec2(1.15, 1.0));
      c.rgb *= 1.0 - vignette * smoothstep(0.45, 0.95, d);
      float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c.rgb += dither / 255.0;
      gl_FragColor = c;
    }`,
};

/**
 * Owns the WebGL context, scene, lighting, camera, and the post-processing
 * chain. Views (terrain, entities, scenery) add objects to `scene`; the game
 * loop calls {@link render} every frame.
 *
 * The look is built the way RuneLite's 117 HD builds its: a physically-based
 * atmospheric {@link Sky} with a real sun disc, prefiltered into an environment
 * map so every surface is lit by the sky it stands under; a warm directional
 * sun casting soft-filtered shadows from a high-resolution map that follows the
 * camera; a pool of dynamic point lights for fires and spells; distance fog;
 * and a composited frame: horizon-based ambient occlusion in the creases, a
 * touch of bloom on the sun, flames and spells, ACES tone mapping from an HDR
 * buffer, MSAA edges, and a final colour grade.
 *
 * The whole chain is a few milliseconds on a mid-range GPU, and the game
 * loop's 50 fps cap keeps it from ever pinning the card the way the uncapped
 * early builds did.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: OrbitCamera;
  /** Unit direction to the sun; shared so water glints and highlights agree. */
  readonly sunDirection = SUN_DIRECTION.clone();
  /** Dynamic point lights for views to request each frame. */
  readonly lights: LightPool;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly sun: THREE.DirectionalLight;
  private readonly sky: Sky;
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  /** Rotation from world into the sun's light space, for snapping the shadow frustum to texels. */
  private readonly lightBasis = new THREE.Matrix4();
  private readonly lightBasisInv = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private frameMs = 0;
  /** Work that must draw before the main pass each frame (planar reflections). */
  private readonly preRender: Array<(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    // MSAA happens on the HDR buffer inside the composer, not on the canvas.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    // 1.5x is plenty on HiDPI screens and keeps the fill-rate cost sane on 4K.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Shadow maps are drawn once per frame (see render), not once per render call.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // applied by the OutputPass
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.info.autoReset = false;

    this.camera = new OrbitCamera(canvas);
    this.scene.fog = new THREE.Fog(FOG_COLOR, 40, 118);

    this.sky = buildSky(this.sunDirection);
    this.scene.environment = this.captureEnvironment(this.sky);
    this.scene.add(this.sky);

    // A faint sky/ground tint under the image-based fill; the sun does the work.
    this.scene.add(new THREE.HemisphereLight(0xd6e6f5, 0x55683a, 0.45));
    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_HALF_EXTENT;
    cam.right = SHADOW_HALF_EXTENT;
    cam.top = SHADOW_HALF_EXTENT;
    cam.bottom = -SHADOW_HALF_EXTENT;
    cam.near = 1;
    cam.far = 200;
    cam.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // The sun never moves, so its light-space basis is fixed: z toward the sun.
    this.lightBasis.lookAt(this.sunDirection, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    this.lightBasisInv.copy(this.lightBasis).invert();

    this.lights = new LightPool(this.scene, 6);

    // --- Post-processing: HDR MSAA scene -> AO -> bloom -> tone map -> grade ---
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const hdr = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, hdr);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera.camera));

    this.gtao = new GTAOPass(this.scene, this.camera.camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.5;
    this.gtao.updateGtaoMaterial({
      radius: 0.28,
      distanceExponent: 1,
      thickness: 1,
      scale: 1,
      samples: 16,
      distanceFallOff: 1,
      screenSpaceRadius: false,
    });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
    // Alpha-tested foliage and screen-facing sprites must stay out of the AO
    // depth buffer, or their invisible quad corners would smear dark halos.
    const gtaoRender = this.gtao.render.bind(this.gtao);
    const hidden: THREE.Object3D[] = [];
    this.gtao.render = (renderer, write, read, delta, mask) => {
      hidden.length = 0;
      this.scene.traverse((o) => {
        if (o.visible && o.userData.noAO) {
          o.visible = false;
          hidden.push(o);
        }
      });
      gtaoRender(renderer, write, read, delta, mask);
      for (const o of hidden) o.visible = true;
    };
    this.composer.addPass(this.gtao);

    // Only the sun disc, flames, and spell bolts are bright enough to bloom.
    this.composer.addPass(new UnrealBloomPass(size, 0.3, 0.55, 1.35));
    this.composer.addPass(new OutputPass()); // ACES tone map + sRGB encode
    this.composer.addPass(new ShaderPass(GRADE_SHADER));

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  /** Register a pass that draws before the main scene pass every frame, e.g. a reflection. */
  addPreRender(fn: (gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void): void {
    this.preRender.push(fn);
  }

  render(): void {
    const t0 = performance.now();
    // Manual reset so the counters reflect a full frame when read between frames.
    this.renderer.info.reset();
    this.sky.position.copy(this.camera.camera.position);
    this.frameShadow();
    this.renderer.shadowMap.needsUpdate = true;
    for (const fn of this.preRender) fn(this.renderer, this.scene, this.camera.camera);
    this.composer.render();
    this.frameMs = performance.now() - t0;
  }

  /** Live WebGL counters (draw calls, triangles) and CPU frame time for diagnostics. */
  get stats(): RenderStats {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, frameMs: this.frameMs };
  }

  /**
   * Keep the shadow frustum on the part of the world the player is looking at:
   * a box centred a little ahead of the camera's focus, with its position
   * snapped to whole shadow-map texels so edges don't shimmer as the camera
   * glides.
   */
  private frameShadow(): void {
    const centre = this.tmp.copy(this.camera.focus).addScaledVector(this.camera.forward(this.tmp2), 6);
    centre.applyMatrix4(this.lightBasisInv);
    const texel = (2 * SHADOW_HALF_EXTENT) / SHADOW_MAP_SIZE;
    centre.x = Math.round(centre.x / texel) * texel;
    centre.y = Math.round(centre.y / texel) * texel;
    centre.applyMatrix4(this.lightBasis);
    this.sun.target.position.copy(centre);
    this.sun.position.copy(centre).addScaledVector(this.sunDirection, 90);
  }

  /**
   * Prefilter the sky into an environment map so every PBR surface picks up
   * ambient light and reflections from the same sky it stands under, the cheap
   * secret behind cohesive outdoor lighting.
   */
  private captureEnvironment(sky: Sky): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const skyScene = new THREE.Scene();
    skyScene.add(sky);
    const tex = pmrem.fromScene(skyScene, 0.03).texture;
    skyScene.remove(sky);
    pmrem.dispose();
    return tex;
  }

  private handleResize = (): void => {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.setAspect(w / h);
  };
}

/** A clear, slightly hazy summer sky with the sun where {@link SUN_DIRECTION} points. */
function buildSky(sunDirection: THREE.Vector3): Sky {
  const sky = new Sky();
  sky.scale.setScalar(2000);
  sky.frustumCulled = false;
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sunDirection);
  return sky;
}
