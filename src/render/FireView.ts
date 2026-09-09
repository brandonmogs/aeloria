import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World } from '../sim/World';
import { Terrain } from './Terrain';
import { LightPool } from './LightPool';
import { flat } from './lowpoly';
import { makeCanvas, tileableNoise, toTexture } from './texgen';

/** Live pieces of one fire, plus a phase so fires flicker out of sync. */
interface FireVisual {
  group: THREE.Group;
  flames: THREE.Mesh;
  embers: THREE.Points;
  /** Per ember: rise speed, sway phase, and age in 0..1. */
  emberState: Float32Array;
  smoke: THREE.Sprite[];
  phase: number;
  range: boolean;
}

const EMBERS = 18;
const SMOKE = 2;

/**
 * Player-lit fires and the kitchen range: crossed alpha-eroded flame cards
 * driven by scrolling noise (bright enough to bloom), a puff of embers
 * drifting up, soft smoke sprites, and a flickering point light from the
 * pool so the ground and anyone standing near glows orange, the way 117 HD's
 * dynamic lights do.
 */
export class FireView {
  private readonly visuals = new Map<number, FireVisual>();
  private readonly logGeo: THREE.BufferGeometry;
  private readonly logMat = flat(0x3e2a17);
  private readonly flameGeo: THREE.BufferGeometry;
  private readonly flameMat: THREE.ShaderMaterial;
  private readonly emberMat: THREE.PointsMaterial;
  private readonly smokeTex: THREE.CanvasTexture;
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly terrain: Terrain,
  ) {
    this.logGeo = new THREE.CylinderGeometry(0.05, 0.065, 0.62, 7);
    this.logGeo.rotateZ(Math.PI / 2);

    // Three crossed cards, pivot at the base.
    const cards: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const card = new THREE.PlaneGeometry(0.6, 0.95);
      card.translate(0, 0.475, 0);
      card.rotateY((i * Math.PI) / 3);
      cards.push(card);
    }
    this.flameGeo = mergeGeometries(cards);

    this.flameMat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        intensity: { value: 2.6 },
        noise: { value: noiseTexture() },
      },
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.smokeTex = softDot();
    this.emberMat = new THREE.PointsMaterial({
      size: 0.05,
      map: this.smokeTex,
      color: new THREE.Color(3.0, 1.1, 0.25),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
  }

  sync(dt: number, lights: LightPool): void {
    this.clock += dt;
    this.flameMat.uniforms.time.value = this.clock;

    for (const fire of this.world.fires.values()) {
      let visual = this.visuals.get(fire.id);
      if (!visual) {
        visual = this.createVisual(fire.tile.x, fire.tile.y, fire.id, fire.kind === 'range');
        this.visuals.set(fire.id, visual);
        this.scene.add(visual.group);
      }
      const t = this.clock + visual.phase;
      // Flames breathe; the light flickers with two incommensurate sines.
      const lick = 1 + Math.sin(t * 9) * 0.06 + Math.sin(t * 23.7) * 0.04;
      visual.flames.scale.set(1 + Math.sin(t * 5.3) * 0.05, lick, 1 + Math.cos(t * 6.1) * 0.05);
      const flicker = 0.82 + 0.18 * (Math.sin(t * 13) * 0.5 + Math.sin(t * 7.3 + 1) * 0.5 + 0.5);
      const p = visual.group.position;
      const lift = visual.range ? 1.1 : 0.45;
      lights.add(p.x, p.y + lift, p.z, 0xffa040, (visual.range ? 5 : 8) * flicker, visual.range ? 5 : 7);

      this.driftEmbers(visual, dt);
      this.driftSmoke(visual, dt);
    }

    for (const [id, visual] of this.visuals) {
      if (!this.world.fires.has(id)) {
        this.scene.remove(visual.group);
        for (const s of visual.smoke) (s.material as THREE.Material).dispose();
        this.visuals.delete(id);
      }
    }
  }

  private driftEmbers(visual: FireVisual, dt: number): void {
    const pos = visual.embers.geometry.attributes.position as THREE.BufferAttribute;
    const st = visual.emberState;
    const base = visual.range ? 1.0 : 0.15;
    for (let i = 0; i < EMBERS; i++) {
      let age = st[i * 3 + 2] + dt * st[i * 3] * 0.55;
      if (age > 1) {
        age -= 1;
        st[i * 3] = 0.6 + Math.random() * 0.9;
        st[i * 3 + 1] = Math.random() * Math.PI * 2;
      }
      st[i * 3 + 2] = age;
      const sway = Math.sin(age * 9 + st[i * 3 + 1]) * 0.06 * age;
      pos.setXYZ(i, Math.cos(st[i * 3 + 1]) * 0.08 + sway, base + age * (visual.range ? 0.6 : 1.3), Math.sin(st[i * 3 + 1]) * 0.08 + sway * 0.5);
    }
    pos.needsUpdate = true;
  }

  private driftSmoke(visual: FireVisual, dt: number): void {
    visual.smoke.forEach((sprite, i) => {
      const cycle = 2.6;
      const tt = ((this.clock + visual.phase + (i * cycle) / SMOKE) % cycle) / cycle;
      const s = 0.25 + tt * 1.0;
      sprite.scale.set(s, s, 1);
      const sway = Math.sin(tt * 4 + i) * 0.12;
      if (visual.range) sprite.position.set(0.3 + sway, 1.7 + tt * 1.4, -0.25);
      else sprite.position.set(sway, 0.7 + tt * 1.5, sway * 0.5);
      (sprite.material as THREE.SpriteMaterial).opacity = Math.sin(tt * Math.PI) * 0.28;
      sprite.material.needsUpdate = false;
      void dt;
    });
  }

  /** A campfire's crossed logs and flames, or, on a range, just the flames on the hob. */
  private createVisual(x: number, y: number, id: number, range: boolean): FireVisual {
    const group = new THREE.Group();
    group.position.set(x, this.terrain.heightAt(x, y), y);

    if (!range) {
      for (const angle of [0.5, -0.7, 1.6]) {
        const log = new THREE.Mesh(this.logGeo, this.logMat);
        log.rotation.y = angle;
        log.position.y = 0.05;
        log.castShadow = true;
        group.add(log);
      }
    }

    const flames = new THREE.Mesh(this.flameGeo, this.flameMat);
    flames.position.y = range ? 0.98 : 0.02;
    if (range) flames.scale.setScalar(0.6);
    flames.userData.noAO = true;
    flames.renderOrder = 3;
    group.add(flames);

    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
    const emberState = new Float32Array(EMBERS * 3);
    for (let i = 0; i < EMBERS; i++) {
      emberState[i * 3] = 0.6 + Math.random() * 0.9;
      emberState[i * 3 + 1] = Math.random() * Math.PI * 2;
      emberState[i * 3 + 2] = Math.random();
    }
    const embers = new THREE.Points(emberGeo, this.emberMat);
    embers.frustumCulled = false;
    embers.renderOrder = 4;
    group.add(embers);

    const smoke: THREE.Sprite[] = [];
    for (let i = 0; i < SMOKE; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.smokeTex, color: 0x6f6a66, transparent: true, opacity: 0.25, depthWrite: false }),
      );
      sprite.userData.noAO = true;
      sprite.renderOrder = 2;
      group.add(sprite);
      smoke.push(sprite);
    }

    return { group, flames, embers, emberState, smoke, phase: id * 2.4, range };
  }
}

/** Tileable noise the flame shader scrolls through. */
function noiseTexture(): THREE.DataTexture {
  const size = 128;
  const n = tileableNoise(size, 4, 5, 4);
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(n[i] * 255);
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return toTexture(rgba, size, false);
}

/** A soft radial dot for embers and smoke. */
function softDot(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const FLAME_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FLAME_FRAGMENT = /* glsl */ `
uniform sampler2D noise;
uniform float time;
uniform float intensity;
varying vec2 vUv;
void main() {
  float n1 = texture2D(noise, vec2(vUv.x * 1.3, vUv.y * 0.8 - time * 0.9)).r;
  float n2 = texture2D(noise, vec2(vUv.x * 2.6 + 0.4, vUv.y * 1.6 - time * 1.5)).r;
  float n = n1 * 0.65 + n2 * 0.35;
  float cx = abs(vUv.x - 0.5) * 2.0;
  float taper = 1.0 - vUv.y * 0.75;
  float body = smoothstep(taper, taper - 0.45, cx);
  float erode = smoothstep(0.35, 0.7, n + (1.0 - vUv.y) * 0.45 - vUv.y * 0.2);
  float a = body * erode * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  vec3 hot = vec3(1.0, 0.92, 0.6);
  vec3 mid = vec3(1.0, 0.55, 0.12);
  vec3 cool = vec3(0.85, 0.2, 0.02);
  float h = (1.0 - vUv.y) * (1.0 - cx * 0.5);
  vec3 col = mix(cool, mix(mid, hot, smoothstep(0.55, 1.0, h)), smoothstep(0.1, 0.6, h));
  gl_FragColor = vec4(col * intensity * a, a);
}`;
