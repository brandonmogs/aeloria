import * as THREE from 'three';
import { ATLAS_H, ATLAS_W, EYE_IRIS, TILE_COLS, TILE_METRES, TILE_ROWS, TILES, TileName, attachmentAtlas } from './attachmentAtlas';
import { Rig } from './characters';
import { clothDetail, hairDetail, leatherDetail } from './characterTextures';

/**
 * Everything a character wears or grows, as one skinned mesh beside the body:
 * the second (and last) draw call of a character. Gear is still built piece
 * by piece in a socket's frame (gear.ts, hair.ts, the eyes), but instead of
 * hanging each piece on a bone as its own mesh with its own material, the
 * pieces are baked into the body's bind space, skinned to the bone they hang
 * from and merged. What used to be a material becomes per-vertex data: the
 * colour, a tile of the shared atlas (see attachmentAtlas.ts) for the
 * surface, and an enchant flag for the glow.
 */

const TILE_INDEX = Object.fromEntries(TILES.map((t, i) => [t, i])) as Record<TileName, number>;

let shared: THREE.MeshStandardMaterial | null = null;

const VERT_PARS = /* glsl */ `
attribute float aTile;
attribute float aEnchant;
uniform vec2 uTileSize;
varying vec2 vTileOrigin;
varying float vEnchant;
`;

const VERT_MAIN = /* glsl */ `
vTileOrigin = vec2( mod( aTile, ${TILE_COLS}.0 ), floor( aTile / ${TILE_COLS}.0 ) ) * uTileSize;
vEnchant = aEnchant;
`;

const FRAG_PARS = /* glsl */ `
uniform vec2 uTileSize;
uniform vec2 uTexel;
uniform float uMaxGrad;
varying vec2 vTileOrigin;
varying float vEnchant;
// A sample from this fragment's tile, the uv wrapped inside it. The mip level
// is chosen from the unwrapped uv so the wrap seam does not show, and capped
// so coarse mips do not bleed the neighbouring tiles in.
vec4 atlasTex( sampler2D t, vec2 uv ) {
	vec2 span = uTileSize - 2.0 * uTexel;
	vec2 gx = dFdx( uv ) * span;
	vec2 gy = dFdy( uv ) * span;
	float g = max( length( gx ), length( gy ) );
	if ( g > uMaxGrad ) {
		gx *= uMaxGrad / g;
		gy *= uMaxGrad / g;
	}
	return texture2DGradEXT( t, vTileOrigin + uTexel + fract( uv ) * span, gx, gy );
}
`;

/** Expand one `#include` into its edited chunk, failing loudly if three's shader text has moved on. */
function expand(src: string, chunk: string, edit: (text: string) => string): string {
  const include = `#include <${chunk}>`;
  if (src.split(include).length !== 2) throw new Error(`attachments: expected one ${include}`);
  const text = THREE.ShaderChunk[chunk as keyof typeof THREE.ShaderChunk] as string;
  const edited = edit(text);
  if (edited === text) throw new Error(`attachments: ${chunk} changed, nothing to edit`);
  return src.replace(include, edited);
}

/** The one material every character's attachments share. */
export function attachmentsMaterial(): THREE.MeshStandardMaterial {
  if (shared) return shared;
  const a = attachmentAtlas();
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: a.albedo,
    normalMap: a.normal,
    roughnessMap: a.orm,
    metalnessMap: a.orm,
    roughness: 1,
    metalness: 1,
    envMapIntensity: 0.7,
    side: THREE.DoubleSide,
    alphaTest: 0.5,
  });
  m.name = 'attachments';
  m.userData.perVertexEnchant = true;
  const uniforms = {
    uTileSize: { value: new THREE.Vector2(1 / TILE_COLS, 1 / TILE_ROWS) },
    uTexel: { value: new THREE.Vector2(1 / ATLAS_W, 1 / ATLAS_H) },
    uMaxGrad: { value: 8 / ATLAS_W },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <uv_vertex>', '#include <uv_vertex>\n' + VERT_MAIN);
    let f = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS);
    f = expand(f, 'map_fragment', (c) =>
      c
        .replace('texture2D( map, vMapUv )', 'atlasTex( map, vMapUv )')
        .replace('diffuseColor *= sampledDiffuseColor;', 'sampledDiffuseColor.a *= atlasTex( roughnessMap, vMapUv ).r;\n\tdiffuseColor *= sampledDiffuseColor;'),
    );
    f = expand(f, 'normal_fragment_maps', (c) => c.split('texture2D( normalMap, vNormalMapUv )').join('atlasTex( normalMap, vNormalMapUv )'));
    f = expand(f, 'roughnessmap_fragment', (c) => c.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'atlasTex( roughnessMap, vRoughnessMapUv )'));
    f = expand(f, 'metalnessmap_fragment', (c) => c.replace('texture2D( metalnessMap, vMetalnessMapUv )', 'atlasTex( metalnessMap, vMetalnessMapUv )'));
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'aeloria-attachments-1';
  shared = m;
  return m;
}

/** What a part's material means once there is only one material: a tile and a tint. */
interface Surface {
  tile: TileName;
  color: THREE.Color;
  enchant: number;
  /** Set for an eyeball: the iris colour. */
  iris?: number;
}

function surfaceOf(mat: THREE.Material | THREE.Material[]): Surface {
  const m = Array.isArray(mat) ? mat[0] : mat;
  if (!(m instanceof THREE.MeshStandardMaterial)) return { tile: 'plain', color: new THREE.Color(0xffffff), enchant: 0 };
  const enchant = m.userData.enchant ? 1 : 0;
  const color = m.color.clone();
  if (m.userData.iris !== undefined) return { tile: 'eye', color: new THREE.Color(0xffffff), enchant, iris: m.userData.iris as number };
  if (m.userData.tile) return { tile: m.userData.tile as TileName, color, enchant };
  if (m.name === 'hair-cap') return { tile: 'hair', color, enchant };
  if (m.name === 'hair-cards') return { tile: 'strand', color, enchant };
  if (m.map === clothDetail().albedo) return { tile: 'cloth', color, enchant };
  if (m.map === leatherDetail().albedo) return { tile: m.metalness > 0.3 ? 'rust' : 'leather', color, enchant };
  if (m.map === hairDetail().albedo) return { tile: 'hair', color, enchant };
  if (m.metalness >= 0.5) return { tile: 'metal', color, enchant };
  return { tile: 'plain', color, enchant };
}

/** The transform from `node`'s local space up to (not including) `stop`. */
function relativeTo(node: THREE.Object3D, stop: THREE.Object3D | null): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  for (let n: THREE.Object3D | null = node; n && n !== stop; n = n.parent) {
    n.updateMatrix();
    m.premultiply(n.matrix);
  }
  return m;
}

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpM3 = new THREE.Matrix3();

/** Accumulates baked parts into one skinned geometry. */
export class AttachmentBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly tile: number[] = [];
  private readonly ench: number[] = [];
  private readonly si: number[] = [];
  private readonly sw: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /**
   * One mesh's geometry, carried by `matrix` into bind space and skinned
   * rigidly to `bone`. `uvScale` repeats the tile across the part.
   */
  mesh(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, bone: number, surface: Surface, uvScale = 1): void {
    const position = geometry.attributes.position as THREE.BufferAttribute;
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const normal = geometry.attributes.normal as THREE.BufferAttribute;
    const uv = geometry.attributes.uv as THREE.BufferAttribute | undefined;
    const color = geometry.attributes.color as THREE.BufferAttribute | undefined;
    const normalMatrix = tmpM3.getNormalMatrix(matrix);
    const base = this.vertexCount;
    const tile = TILE_INDEX[surface.tile];
    const c = surface.color;
    for (let i = 0; i < position.count; i++) {
      tmpV.fromBufferAttribute(position, i).applyMatrix4(matrix);
      tmpN.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      this.pos.push(tmpV.x, tmpV.y, tmpV.z);
      this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      this.uv.push(uv ? uv.getX(i) * uvScale : 0, uv ? uv.getY(i) * uvScale : 0);
      if (color) this.col.push(c.r * color.getX(i), c.g * color.getY(i), c.b * color.getZ(i), color.itemSize > 3 ? color.getW(i) : 1);
      else this.col.push(c.r, c.g, c.b, 1);
      this.tile.push(tile);
      this.ench.push(surface.enchant);
      this.si.push(bone, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
    }
    const index = geometry.index;
    const n = index ? index.count : position.count;
    for (let i = 0; i < n; i++) this.idx.push(base + (index ? index.getX(i) : i));
  }

  /**
   * A gear object built in a bone's local frame (its parent is that bone, or
   * nothing): every visible mesh under it, baked by what its material was.
   */
  object(object: THREE.Object3D, bone: number, bindWorld: THREE.Matrix4, enchant = 0): void {
    const stop = object.parent;
    const walk = (node: THREE.Object3D): void => {
      if (!node.visible) return;
      if (node instanceof THREE.Mesh) {
        const matrix = relativeTo(node, stop).premultiply(bindWorld);
        const geometry = node.geometry as THREE.BufferGeometry;
        const surface = surfaceOf(node.material);
        if (enchant) surface.enchant = enchant;
        if (surface.iris !== undefined) {
          this.eye(geometry, matrix, bone, surface);
        } else {
          const metres = TILE_METRES[surface.tile];
          let uvScale = 1;
          if (metres > 0) {
            if (!geometry.boundingSphere) geometry.computeBoundingSphere();
            const extent = 2 * geometry.boundingSphere!.radius * tmpV.setFromMatrixScale(matrix).x;
            uvScale = Math.max(1, Math.min(12, Math.round(extent / metres)));
          }
          this.mesh(geometry, matrix, bone, surface, uvScale);
        }
      }
      for (const child of node.children) walk(child);
    };
    walk(object);
  }

  /**
   * An eyeball: the white sphere, then an iris cap over its +z pole tinted
   * with the iris colour. The cap is a spherical cap of three rings sitting
   * just off the sphere, so the sphere's facets never poke through it.
   */
  private eye(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, bone: number, surface: Surface): void {
    this.mesh(geometry, matrix, bone, surface);
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const r = geometry.boundingSphere!.radius * 1.03;
    const cap = new THREE.BufferGeometry();
    const N = 16;
    const RINGS = 3;
    const theta = 0.52;
    const pos: number[] = [0, 0, r];
    const nor: number[] = [0, 0, 1];
    const uvs: number[] = [EYE_IRIS.u, EYE_IRIS.v];
    const idx: number[] = [];
    const uvR = EYE_IRIS.radius * 1.03;
    for (let ring = 1; ring <= RINGS; ring++) {
      const t = ring / RINGS;
      for (let k = 0; k < N; k++) {
        const phi = (k / N) * Math.PI * 2;
        const x = Math.sin(theta * t) * Math.cos(phi);
        const y = Math.sin(theta * t) * Math.sin(phi);
        const z = Math.cos(theta * t);
        pos.push(x * r, y * r, z * r);
        nor.push(x, y, z);
        uvs.push(EYE_IRIS.u + uvR * t * Math.cos(phi), EYE_IRIS.v + uvR * t * Math.sin(phi));
        const here = 1 + (ring - 1) * N + k;
        const next = 1 + (ring - 1) * N + ((k + 1) % N);
        if (ring === 1) idx.push(0, here, next);
        else idx.push(here - N, here, next, here - N, next, next - N);
      }
    }
    cap.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cap.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    cap.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    cap.setIndex(idx);
    this.mesh(cap, matrix, bone, { tile: 'eye', color: new THREE.Color(surface.iris), enchant: 0 });
  }

  build(): THREE.BufferGeometry | null {
    if (this.idx.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    geo.setAttribute('aTile', new THREE.Float32BufferAttribute(this.tile, 1));
    geo.setAttribute('aEnchant', new THREE.Float32BufferAttribute(this.ench, 1));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    geo.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    geo.computeBoundingSphere();
    return geo;
  }
}

/**
 * Sweep every prop hanging on the rig's bones (worn gear, hair, eyes, race
 * extras, base boots) into one skinned mesh on the body's skeleton, and take
 * the props down. Returns the mesh, or null when the rig has no skinned body
 * or nothing was hanging on it.
 */
export function mergeAttachments(rig: Rig): THREE.SkinnedMesh | null {
  const body = rig.body;
  const bones = rig.bones;
  if (!body || !bones) return null;
  const skeleton = body.skeleton;
  const builder = new AttachmentBuilder();
  bones.forEach((bone, bi) => {
    const bindWorld = skeleton.boneInverses[bi].clone().invert();
    for (const child of [...bone.children]) {
      if (child instanceof THREE.Bone) continue;
      builder.object(child, bi, bindWorld);
      bone.remove(child);
    }
  });
  const geo = builder.build();
  if (!geo) return null;
  const mesh = new THREE.SkinnedMesh(geo, attachmentsMaterial());
  mesh.name = 'attachments';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.bind(skeleton, body.bindMatrix);
  rig.group.add(mesh);
  rig.attachments = mesh;
  rig.hair = undefined;
  return mesh;
}
