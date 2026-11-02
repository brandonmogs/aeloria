import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GRADE_SHADER, SUN_DIRECTION } from '../../render/Renderer';
import { Animator, Rig } from '../../render/characters';
import { HERO_BUILD, HumanoidSpec, bodyFor, buildHumanoid } from '../../render/human';
import { mergeAttachments } from '../../render/attachments';
import { Outfit, billowCape, dressRig } from '../../render/outfit';
import { raceExtras } from '../../render/raceGear';
import { characterStyle, setRimDirection, styleCharacter } from '../../render/characterStyle';
import { AnimationName, Framing, LabConfig, LightingPreset, Locomotion, RACES } from './config';

/**
 * The character preview stage: one figure on a turntable under a choice of
 * lighting rigs, drawn through the same post chain as the game (HDR MSAA,
 * ambient occlusion, bloom, ACES, grade) so what it shows is what the world
 * will show.
 */

export interface LabStats {
  /** Meshes drawn for the character: one draw call each until they are merged. */
  characterCalls: number;
  characterTriangles: number;
  skinnedVertices: number;
  /** Whole-frame GL counters, post-processing included. */
  calls: number;
  triangles: number;
  frameMs: number;
  /** Milliseconds spent posing the skeleton and rippling the cape this frame. */
  animMs: number;
}

interface SkyLook {
  turbidity: number;
  rayleigh: number;
  mie: number;
  /** Where the sky's sun sits when it differs from the key light (a dusk sky under moonlight). */
  sun?: THREE.Vector3;
}

interface LightRig {
  sun: THREE.Vector3;
  sunColor: number;
  sunIntensity: number;
  /** A second, shadowless light from behind (studio back light). */
  back?: { dir: THREE.Vector3; color: number; intensity: number };
  hemi: readonly [number, number, number];
  /** The environment map: the preset's sky, or a grey room with soft boxes. */
  env: 'sky' | 'room';
  roomIntensity?: number;
  sky: SkyLook;
  background: 'sky' | number;
  exposure: number;
  rimColor: number;
  ground: number;
}

const dir = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).normalize();

export const LIGHT_RIGS: Record<LightingPreset, LightRig> = {
  sun: {
    sun: SUN_DIRECTION.clone(),
    sunColor: 0xfff1d8,
    sunIntensity: 2.7,
    hemi: [0xd6e6f5, 0x55683a, 0.45],
    env: 'sky',
    sky: { turbidity: 4, rayleigh: 1.4, mie: 0.004 },
    background: 'sky',
    exposure: 0.55,
    rimColor: 0x9fc4ff,
    ground: 0x4a5a38,
  },
  golden: {
    sun: dir(0.75, 0.22, 0.6),
    sunColor: 0xffb060,
    sunIntensity: 3.4,
    hemi: [0xf4cfa0, 0x4a3b2a, 0.35],
    env: 'sky',
    sky: { turbidity: 6, rayleigh: 2, mie: 0.006 },
    background: 'sky',
    exposure: 0.5,
    rimColor: 0xffc27a,
    ground: 0x4f4634,
  },
  overcast: {
    sun: dir(0.2, 1, 0.3),
    sunColor: 0xe6ecf2,
    sunIntensity: 0.5,
    hemi: [0xd9e0e8, 0x6c6c68, 1.2],
    env: 'sky',
    sky: { turbidity: 14, rayleigh: 0.6, mie: 0.02 },
    background: 'sky',
    exposure: 0.6,
    rimColor: 0xffffff,
    ground: 0x45474a,
  },
  moonlit: {
    sun: dir(0.45, 0.7, 0.55),
    sunColor: 0x8fb0ff,
    sunIntensity: 2.4,
    hemi: [0x3a4c78, 0x14171c, 0.9],
    env: 'sky',
    sky: { turbidity: 5, rayleigh: 2.5, mie: 0.003, sun: dir(0.4, -0.06, 0.9) },
    background: 'sky',
    exposure: 1.0,
    rimColor: 0x6a9bff,
    ground: 0x23262e,
  },
  studio: {
    sun: dir(0.55, 0.8, 0.65),
    sunColor: 0xfff4e6,
    sunIntensity: 2.2,
    back: { dir: dir(-0.45, 0.55, -0.75), color: 0xdfe9ff, intensity: 1.6 },
    hemi: [0xbfc8d6, 0x3a3a3a, 0.55],
    env: 'room',
    roomIntensity: 0.55,
    sky: { turbidity: 4, rayleigh: 1.4, mie: 0.004 },
    background: 0x2b2e34,
    exposure: 0.65,
    rimColor: 0xffffff,
    ground: 0x303236,
  },
};

/** Tiles per second: one tile a tick walking, two running. */
const WALK_SPEED = 1 / 0.6;
const RUN_SPEED = 2 / 0.6;

export class CharacterLab {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
  /** Spins the character under fixed lights. */
  readonly turntable = new THREE.Group();
  turning = true;
  turnSpeed = 0.5;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly sun: THREE.DirectionalLight;
  private readonly back: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly ground: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envCache = new Map<LightingPreset, THREE.Texture>();
  private readonly rimWorld = new THREE.Vector3(0, 0.4, -1);

  private rig: Rig | null = null;
  private outfit: Outfit | null = null;
  private anim: Animator | null = null;
  private height = 1.8;
  private animation: AnimationName = 'idle';
  private locomotion: Locomotion = 'idle';
  private clock = 0;
  private frameMs = 0;
  private animMs = 0;
  private character = { calls: 0, triangles: 0, skinnedVertices: 0 };

  private readonly orbit = { yaw: 0.35, pitch: 0.1, distance: 3.6, targetY: 0.95 };
  private drag: { button: number; x: number; y: number } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.info.autoReset = false;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.hemi = new THREE.HemisphereLight(0xd6e6f5, 0x55683a, 0.45);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.02;
    const sc = this.sun.shadow.camera;
    sc.left = -2.5;
    sc.right = 2.5;
    sc.top = 3;
    sc.bottom = -1;
    sc.near = 0.5;
    sc.far = 30;
    sc.updateProjectionMatrix();
    this.sun.target.position.set(0, 0.9, 0);
    this.scene.add(this.sun, this.sun.target);
    this.back = new THREE.DirectionalLight(0xdfe9ff, 0);
    this.back.target.position.set(0, 0.9, 0);
    this.scene.add(this.back, this.back.target);

    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 64),
      new THREE.MeshStandardMaterial({ color: 0x4a5a38, roughness: 0.95, metalness: 0 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.scene.add(this.turntable);

    // --- Post-processing: the game's chain (HDR MSAA -> AO -> bloom -> tone map -> grade) ---
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const hdr = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, hdr);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.5;
    gtao.updateGtaoMaterial({
      radius: 0.28,
      distanceExponent: 1,
      thickness: 1,
      scale: 1,
      samples: 16,
      distanceFallOff: 1,
      screenSpaceRadius: false,
    });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
    // Alpha-tested hair cards stay out of the AO depth buffer, as in the game.
    const gtaoRender = gtao.render.bind(gtao);
    const hidden: THREE.Object3D[] = [];
    gtao.render = (renderer, write, read, delta, mask) => {
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
    this.composer.addPass(gtao);
    this.composer.addPass(new UnrealBloomPass(size, 0.3, 0.55, 1.35));
    this.composer.addPass(new OutputPass());
    const grade = new ShaderPass(GRADE_SHADER);
    grade.uniforms.vignette.value = 0.16;
    this.composer.addPass(grade);

    this.setLighting('sun');
    this.bindControls();
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  get hasCharacter(): boolean {
    return this.rig !== null;
  }

  /** Build (or rebuild) the figure from the config: body, hair, painted outfit and worn gear. */
  setCharacter(cfg: LabConfig): void {
    this.clearCharacter();
    const race = RACES[cfg.race];
    const spec: HumanoidSpec = {
      ...HERO_BUILD,
      ...race.build[cfg.sex],
      body: bodyFor(cfg.race, cfg.sex),
      height: cfg.height,
      hair: cfg.hair,
      bracers: true,
      palette: { skin: cfg.skin, hair: cfg.hairColor, tunic: cfg.tunic, trouser: cfg.trouser, boots: 0x3b2a1c, eyes: cfg.eyes },
      extras: raceExtras(cfg.race, cfg.sex, cfg.hairColor),
    };
    const rig = buildHumanoid(spec);
    const outfit = dressRig(rig, cfg.equipment);
    if (outfit.weapon) enchant(outfit.weapon);
    if (cfg.merged && mergeAttachments(rig)) outfit.cape = undefined; // the cloth is baked; nothing to billow
    styleCharacter(rig.group);
    this.turntable.add(rig.group);
    this.rig = rig;
    this.outfit = outfit;
    this.anim = new Animator(rig);
    this.height = cfg.height;
    this.measure();
    this.setAnimation(this.animation);
  }

  /** Idle, a treadmill walk or run, or one of the layered action clips (looping, except the death). */
  setAnimation(name: AnimationName): void {
    this.animation = name;
    if (!this.anim) return;
    if (this.anim.playing === 'death') this.anim.reset();
    else this.anim.stopAction();
    if (name === 'idle' || name === 'walk' || name === 'run') {
      this.locomotion = name;
    } else {
      this.locomotion = 'idle';
      this.anim.play(name, name !== 'death');
    }
  }

  replay(): void {
    this.anim?.reset();
    this.setAnimation(this.animation);
  }

  setLighting(preset: LightingPreset): void {
    const rig = LIGHT_RIGS[preset];
    this.sun.color.set(rig.sunColor);
    this.sun.intensity = rig.sunIntensity;
    this.sun.position.copy(rig.sun).multiplyScalar(10).add(this.sun.target.position);
    if (rig.back) {
      this.back.intensity = rig.back.intensity;
      this.back.color.set(rig.back.color);
      this.back.position.copy(rig.back.dir).multiplyScalar(10).add(this.back.target.position);
    } else {
      this.back.intensity = 0;
    }
    this.hemi.color.set(rig.hemi[0]);
    this.hemi.groundColor.set(rig.hemi[1]);
    this.hemi.intensity = rig.hemi[2];
    const env = this.environmentFor(preset, rig);
    this.scene.environment = env;
    // The sky is shown through its prefiltered environment map, dimmed: the
    // real sky dome is bright enough in HDR to bloom into a veil over the
    // whole figure when it fills the frame, which never happens in the game's
    // top-down view.
    if (rig.background === 'sky') {
      this.scene.background = env;
      this.scene.backgroundIntensity = 0.32;
      this.scene.backgroundBlurriness = 0.12;
    } else {
      this.scene.background = new THREE.Color(rig.background);
    }
    this.renderer.toneMappingExposure = rig.exposure;
    this.ground.material.color.set(rig.ground);
    characterStyle.rimColor.value.set(rig.rimColor);
    // The rim light comes from the back light when there is one, else from opposite the sun.
    this.rimWorld.copy(rig.back?.dir ?? dir(-rig.sun.x, 0.45, -rig.sun.z));
  }

  /** Frame the whole figure, the torso, or the head. */
  frame(kind: Framing): void {
    const h = this.height;
    const o = this.orbit;
    switch (kind) {
      case 'full':
        o.targetY = h * 0.5;
        o.distance = h * 1.95;
        o.pitch = 0.08;
        break;
      case 'torso':
        o.targetY = h * 0.72;
        o.distance = h * 0.8;
        o.pitch = 0.05;
        break;
      case 'head':
        o.targetY = h * 0.915;
        o.distance = h * 0.34;
        o.pitch = 0.02;
        break;
    }
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.turning) this.turntable.rotation.y += this.turnSpeed * dt;

    const t0 = performance.now();
    if (this.anim && this.rig) {
      const loco = this.locomotion;
      const speed = loco === 'walk' ? WALK_SPEED : loco === 'run' ? RUN_SPEED : 0;
      this.anim.update({ moved: speed * dt, moving: speed > 0, running: loco === 'run', time: this.clock }, dt);
      this.rig.group.position.y = this.anim.rootOffset;
      if (this.outfit?.cape) billowCape(this.outfit.cape, loco === 'run' ? 1 : loco === 'walk' ? 0.6 : 0, this.clock);
    }
    this.animMs = performance.now() - t0;

    characterStyle.time.value = this.clock;
    this.placeCamera();
    setRimDirection(this.rimWorld, this.camera);

    const t1 = performance.now();
    this.renderer.info.reset();
    this.composer.render();
    this.frameMs = performance.now() - t1;
  }

  get stats(): LabStats {
    const r = this.renderer.info.render;
    return {
      characterCalls: this.character.calls,
      characterTriangles: this.character.triangles,
      skinnedVertices: this.character.skinnedVertices,
      calls: r.calls,
      triangles: r.triangles,
      frameMs: this.frameMs,
      animMs: this.animMs,
    };
  }

  private clearCharacter(): void {
    if (!this.rig) return;
    this.turntable.remove(this.rig.group);
    // Shared template attributes are simply re-uploaded by the next body.
    this.rig.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.rig = null;
    this.outfit = null;
    this.anim = null;
  }

  private measure(): void {
    const c = { calls: 0, triangles: 0, skinnedVertices: 0 };
    this.rig?.group.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const g = o.geometry as THREE.BufferGeometry;
      c.calls++;
      c.triangles += Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
      if (o instanceof THREE.SkinnedMesh) c.skinnedVertices += g.attributes.position.count;
    });
    this.character = c;
  }

  private environmentFor(preset: LightingPreset, rig: LightRig): THREE.Texture {
    let env = this.envCache.get(preset);
    if (env) return env;
    const scene = new THREE.Scene();
    if (rig.env === 'room') {
      scene.add(...studioRoom(rig.roomIntensity ?? 1));
    } else {
      const sky = new Sky();
      sky.scale.setScalar(1000);
      configureSky(sky, rig.sky, rig.sun);
      scene.add(sky);
    }
    env = this.pmrem.fromScene(scene, 0.03).texture;
    this.envCache.set(preset, env);
    return env;
  }

  private placeCamera(): void {
    const o = this.orbit;
    const r = Math.cos(o.pitch) * o.distance;
    this.camera.position.set(Math.sin(o.yaw) * r, o.targetY + Math.sin(o.pitch) * o.distance, Math.cos(o.yaw) * r);
    this.camera.lookAt(0, o.targetY, 0);
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
  }

  /** Left-drag orbits, right-drag raises or lowers the view, the wheel zooms. */
  private bindControls(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      this.drag = { button: e.button, x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointerup', () => (this.drag = null));
    c.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      const o = this.orbit;
      if (this.drag.button === 0) {
        o.yaw -= dx * 0.006;
        o.pitch = clamp(o.pitch + dy * 0.004, -0.6, 1.4);
      } else {
        o.targetY = clamp(o.targetY + dy * 0.0025 * o.distance, 0, this.height * 1.2);
      }
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.orbit.distance = clamp(this.orbit.distance * (e.deltaY > 0 ? 1.12 : 1 / 1.12), 0.25, 12);
      },
      { passive: false },
    );
  }

  private readonly resize = (): void => {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}

function configureSky(sky: Sky, look: SkyLook, sun: THREE.Vector3): void {
  const u = sky.material.uniforms;
  u.turbidity.value = look.turbidity;
  u.rayleigh.value = look.rayleigh;
  u.mieCoefficient.value = look.mie;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(look.sun ?? sun);
}

/**
 * A studio environment for reflections: a grey room, lighter above than
 * below, with a big soft box in front and two rim strips behind.
 */
function studioRoom(intensity: number): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];
  const geo = new THREE.SphereGeometry(20, 24, 12);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 20;
    const g = (0.1 + 0.28 * Math.max(0, y) + 0.03 * Math.max(0, -y)) * intensity;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = g;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  objects.push(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const panel = (w: number, h: number, at: THREE.Vector3, bright: number): void => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(bright * intensity), side: THREE.DoubleSide }),
    );
    m.position.copy(at);
    m.lookAt(0, 1, 0);
    objects.push(m);
  };
  panel(6, 4, new THREE.Vector3(5, 7, 6), 6);
  panel(2, 6, new THREE.Vector3(-7, 4, -6), 8);
  panel(2, 6, new THREE.Vector3(7, 4, -7), 5);
  return objects;
}

/**
 * Flag a weapon's metal for the enchant glow. Its materials are shared with
 * every other piece of that metal, so the weapon gets its own copies here;
 * the real thing is a painted emissive mask once equipment has an atlas.
 */
function enchant(weapon: THREE.Object3D): void {
  weapon.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
    if (o.material.metalness < 0.5) return;
    const m = o.material.clone();
    m.userData.enchant = true;
    o.material = m;
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
