import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TileMap } from '../sim/TileMap';
import { Terrain } from './Terrain';
import { alphaTexture, hsl, makeCanvas, seeded } from './texgen';

/** How many tufts to try to scatter across the map (fewer land: only on grass). */
const TUFTS = 16000;

/**
 * Ground cover: thousands of small alpha-tested grass tufts scattered over
 * the grassy parts of the map as one instanced draw. Their lighting normals
 * point straight up so they shade exactly like the ground texture beneath
 * them and read as its blades standing up, and they lean in the same breeze
 * as the tree canopies. Something 117 HD never had.
 */
export class GrassView {
  private readonly time = { value: 0 };

  constructor(scene: THREE.Scene, map: TileMap, terrain: Terrain) {
    const rnd = seeded(0x9a55);
    const matrices: THREE.Matrix4[] = [];
    const tints: THREE.Color[] = [];
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < TUFTS; i++) {
      const x = rnd() * (map.width + 6) - 3;
      const z = rnd() * (map.height + 6) - 3;
      const grass = terrain.grassWeightAt(x, z);
      if (grass < 0.55 || rnd() > grass) continue;
      const tx = Math.round(x);
      const tz = Math.round(z);
      if (map.inBounds(tx, tz) && map.isBlocked(tx, tz)) continue;
      pos.set(x, terrain.heightAt(x, z) - 0.02, z);
      quat.setFromAxisAngle(up, rnd() * Math.PI * 2);
      const s = 0.7 + rnd() * 0.6;
      scl.set(s, s * (0.8 + rnd() * 0.5), s);
      matrices.push(new THREE.Matrix4().compose(pos, quat, scl));
      tints.push(new THREE.Color().setHSL(0.19 + rnd() * 0.06, 0.28 + rnd() * 0.16, 0.3 + rnd() * 0.12));
    }

    const geo = makeTuftGeometry();
    const material = makeTuftMaterial(tuftTexture(), this.time);
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, matrices.length));
    matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, tints[i]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.noAO = true;
    scene.add(mesh);
  }

  update(dt: number): void {
    this.time.value += dt;
  }
}

/** Two crossed quads, pivot at the base, each drawn from both sides. */
function makeTuftGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 2; i++) {
    const front = new THREE.PlaneGeometry(0.34, 0.24);
    front.translate(0, 0.12, 0);
    front.rotateY((i * Math.PI) / 2);
    const back = front.clone();
    back.rotateY(Math.PI);
    parts.push(front, back);
  }
  return mergeGeometries(parts);
}

/** A fan of blades on a transparent card. */
function tuftTexture(): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = makeCanvas(size);
  const rnd = seeded(0x7a57);
  ctx.clearRect(0, 0, size, size);
  for (let b = 0; b < 11; b++) {
    const x0 = size * 0.5 + (rnd() - 0.5) * size * 0.5;
    const lean = (rnd() - 0.5) * size * 0.8;
    const tipY = size * (0.05 + rnd() * 0.35);
    const w = 3 + rnd() * 4;
    ctx.fillStyle = hsl(68 + rnd() * 28, 30 + rnd() * 16, 26 + rnd() * 16);
    ctx.beginPath();
    ctx.moveTo(x0 - w, size);
    ctx.quadraticCurveTo(x0 + lean * 0.3, size * 0.55, x0 + lean, tipY);
    ctx.quadraticCurveTo(x0 + lean * 0.35, size * 0.55, x0 + w, size);
    ctx.closePath();
    ctx.fill();
  }
  return alphaTexture(canvas);
}

/** Alpha-tested, lit as if it were the ground, swaying in the wind. */
function makeTuftMaterial(map: THREE.Texture, time: { value: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map,
    alphaTest: 0.4,
    alphaToCoverage: true,
    side: THREE.FrontSide,
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.55,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float time;')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(normal);\nvec3 tuftWorld = (instanceMatrix * vec4(position, 1.0)).xyz;')
      .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalMatrix * vec3(0.0, 1.0, 0.0);')
      .replace(
        '#include <begin_vertex>',
        'vec3 transformed = vec3(position);\nfloat swayT = uv.y * uv.y;\nvec3 sway = vec3(sin(time * 1.6 + tuftWorld.x * 0.9 + tuftWorld.z * 0.7), 0.0, cos(time * 1.3 + tuftWorld.z * 0.8)) * 0.04 * swayT;\ntransformed += inverse(mat3(instanceMatrix)) * sway;',
      );
  };
  mat.customProgramCacheKey = () => 'aeloria-grass';
  return mat;
}
