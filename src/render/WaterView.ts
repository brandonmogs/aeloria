import * as THREE from 'three';
import { MoatLayout, WorldRect } from '../world/startingWorld';
import { WATER_LEVEL } from './Terrain';
import { buildBridge, makeCastleMaterials } from './castle';
import { Renderer } from './Renderer';
import { normalMap, tileableNoise, toTexture } from './texgen';
import { PhotoLibrary } from './assets';

/**
 * The castle moat as real water: a planar reflection of the whole scene
 * (sky, walls, trees) rendered once per frame from a mirrored camera, rippled
 * by two scrolling normal maps, blended with a murky body colour by a Schlick
 * Fresnel term so it goes glassy at grazing angles and green-dark looking
 * straight down, a sharp sun glint that blooms, and foam lapping a noisy
 * shoreline where the sheet fades into the bank. Also builds the timber
 * bridge across the south gap.
 */
export class WaterView {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly mirror = new THREE.PerspectiveCamera();
  private readonly textureMatrix = new THREE.Matrix4();
  private readonly plane = new THREE.Plane();
  private readonly clipPlane = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly origin = new THREE.Vector3(0, WATER_LEVEL, 0);
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly rotation = new THREE.Matrix4();

  constructor(renderer: Renderer, moat: MoatLayout, photos?: PhotoLibrary) {
    this.target = new THREE.WebGLRenderTarget(1024, 1024, { type: THREE.HalfFloatType });
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          tReflection: { value: null },
          tNormal: { value: makeRippleNormals() },
          textureMatrix: { value: this.textureMatrix },
          time: { value: 0 },
          sunDirection: { value: renderer.sunDirection.clone() },
          deepColor: { value: new THREE.Color(0x0c1a1a) },
          shallowColor: { value: new THREE.Color(0x2b3d31) },
          outerMin: { value: new THREE.Vector2(moat.outer.x0, moat.outer.z0) },
          outerMax: { value: new THREE.Vector2(moat.outer.x1, moat.outer.z1) },
          innerMin: { value: new THREE.Vector2(moat.inner.x0, moat.inner.z0) },
          innerMax: { value: new THREE.Vector2(moat.inner.x1, moat.inner.z1) },
        },
      ]),
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.material.uniforms.tReflection.value = this.target.texture;

    const geo = buildRingGeometry(moat, 0.5); // overhang the banks so the waterline is the terrain's
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 1;
    this.mesh.userData.noAO = true;
    renderer.scene.add(this.mesh);

    const b = moat.bridge;
    renderer.scene.add(buildBridge(makeCastleMaterials(photos), b.x0, b.x1, b.z0, b.z1));

    renderer.addPreRender((gl, scene, camera) => this.renderReflection(gl, scene, camera));
  }

  update(dt: number): void {
    this.material.uniforms.time.value += dt;
  }

  /**
   * Draw the scene from the camera's mirror image below the water into the
   * reflection target, with the projection's near plane tilted onto the water
   * surface so nothing under the water leaks into the reflection.
   */
  private renderReflection(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const camPos = this.tmpA.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= WATER_LEVEL + 0.05) return; // camera under the surface: nothing to mirror

    const view = this.tmpB.subVectors(this.origin, camPos);
    view.reflect(this.up).negate().add(this.origin);
    this.mirror.position.copy(view);

    this.rotation.extractRotation(camera.matrixWorld);
    const lookAt = this.tmpB.set(0, 0, -1).applyMatrix4(this.rotation).add(camPos);
    const target = lookAt.sub(this.origin).negate().reflect(this.up).negate().add(this.origin);
    this.mirror.up.set(0, 1, 0).applyMatrix4(this.rotation).reflect(this.up);
    this.mirror.lookAt(target);
    this.mirror.near = camera.near;
    this.mirror.far = camera.far;
    this.mirror.updateMatrixWorld();
    this.mirror.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(this.mirror.projectionMatrix).multiply(this.mirror.matrixWorldInverse);

    // Oblique near plane (Lengyel): clip everything below the water surface.
    this.plane.setFromNormalAndCoplanarPoint(this.up, this.origin);
    this.plane.applyMatrix4(this.mirror.matrixWorldInverse);
    const clip = this.clipPlane.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const p = this.mirror.projectionMatrix.elements;
    this.q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    clip.multiplyScalar(2 / clip.dot(this.q));
    p[2] = clip.x;
    p[6] = clip.y;
    p[10] = clip.z + 1 - 0.003;
    p[14] = clip.w;

    this.mesh.visible = false;
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(this.target);
    gl.clear();
    gl.render(scene, this.mirror);
    gl.setRenderTarget(previous);
    this.mesh.visible = true;
  }
}

/** Fine ripples: tileable noise turned into a normal map, scrolled twice in the shader. */
function makeRippleNormals(): THREE.DataTexture {
  const size = 256;
  const a = tileableNoise(size, 4, 21, 3);
  const b = tileableNoise(size, 3, 22, 6);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = a[i] * 0.7 + b[i] * 0.3;
  return toTexture(normalMap(h, size, 2.2), size, false);
}

const WATER_VERTEX = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vReflectUv;
varying vec3 vWorldPos;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vReflectUv = textureMatrix * worldPos;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAGMENT = /* glsl */ `
uniform sampler2D tReflection;
uniform sampler2D tNormal;
uniform float time;
uniform vec3 sunDirection;
uniform vec3 deepColor;
uniform vec3 shallowColor;
uniform vec2 outerMin;
uniform vec2 outerMax;
uniform vec2 innerMin;
uniform vec2 innerMax;
varying vec4 vReflectUv;
varying vec3 vWorldPos;
#include <common>
#include <fog_pars_fragment>

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Distance inward from the nearest bank of the ring (negative past the banks).
float shoreDistance(vec2 p) {
  float dOuter = min(min(p.x - outerMin.x, outerMax.x - p.x), min(p.y - outerMin.y, outerMax.y - p.y));
  vec2 dIn = max(max(innerMin - p, p - innerMax), vec2(0.0));
  return min(dOuter, length(dIn));
}

void main() {
  vec2 p = vWorldPos.xz;

  // Ripples: two scrolling reads of the normal map at different scales, plus
  // a slow broad swell, flattened into a mostly-upward world normal.
  vec3 n1 = texture2D(tNormal, p * 0.32 + vec2(time * 0.018, time * 0.011)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tNormal, p * 0.85 + vec2(-time * 0.026, time * 0.02)).xyz * 2.0 - 1.0;
  float swell = vnoise(p * 0.5 + vec2(time * 0.05, -time * 0.04));
  vec2 ripple = n1.xy * 0.6 + n2.xy * 0.4 + vec2(swell - 0.5) * 0.15;
  vec3 nrm = normalize(vec3(ripple.x * 0.35, 1.0, ripple.y * 0.35));

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float cosT = clamp(dot(viewDir, nrm), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

  // The mirror image, wavering with the ripples.
  vec2 uv = vReflectUv.xy / vReflectUv.w + nrm.xz * 0.05;
  vec3 reflection = texture2D(tReflection, uv).rgb;

  // Murky body: greener near the banks, dark in the middle, and the mirror
  // creeping in with the Fresnel term (a moat is never a clean mirror).
  float shore = shoreDistance(p);
  vec3 body = mix(shallowColor, deepColor, smoothstep(0.0, 1.6, shore));
  vec3 col = mix(body, reflection, clamp(0.14 + fresnel * 1.3, 0.0, 0.92));

  // Sun glint: tight and bright enough to bloom.
  vec3 halfV = normalize(viewDir + sunDirection);
  float glint = pow(max(dot(nrm, halfV), 0.0), 240.0);
  col += vec3(1.0, 0.95, 0.85) * glint * 3.0;

  // Organic shoreline: the rectangular geometry edge always lands at alpha 0,
  // so the water fades into the bank along a line pulled about by noise, with
  // broken foam riding the wet edge.
  float bank = vnoise(p * 0.6) * 0.7 + vnoise(p * 1.9) * 0.3;
  float shoreDist = shore - bank * 0.45;
  float alpha = smoothstep(0.0, 0.25, shoreDist) * 0.9;
  float foam = smoothstep(0.35, 0.04, shoreDist) * (0.35 + 0.65 * vnoise(p * 3.0 + vec2(time * 0.4, -time * 0.3)));
  col = mix(col, vec3(0.8, 0.86, 0.86), foam * 0.55 * smoothstep(0.0, 0.12, shoreDist));

  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

/** A flat rectangular ring (outer rect with the inner rect punched out), grown by `pad`. */
function buildRingGeometry(moat: MoatLayout, pad: number): THREE.ShapeGeometry {
  const shape = rectPath(grow(moat.outer, pad));
  shape.holes.push(rectPath(grow(moat.inner, -pad)));
  return new THREE.ShapeGeometry(shape);
}

function grow(r: WorldRect, by: number): WorldRect {
  return { x0: r.x0 - by, z0: r.z0 - by, x1: r.x1 + by, z1: r.z1 + by };
}

/**
 * A rectangle in shape space. Shape Y maps to world -Z after the mesh's -90° X
 * rotation, so negate Z here to keep world orientation correct.
 */
function rectPath(r: WorldRect): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(r.x0, -r.z0);
  s.lineTo(r.x1, -r.z0);
  s.lineTo(r.x1, -r.z1);
  s.lineTo(r.x0, -r.z1);
  s.closePath();
  return s;
}
