import * as THREE from 'three';

/**
 * The stylised pass over character materials: the semi-realistic look of an
 * early-2000s Korean MMO character screen laid on top of plain PBR, so the
 * figures still sit in the world's lighting. Each piece is a shared uniform
 * with a strength of 0 meaning off, so the preview page can A/B it against
 * the plain render and one change updates every character at once; nothing
 * is cloned per player.
 *
 * - wrap: soft half-Lambert diffuse on skin and cloth (metals stay crisp)
 * - specBoost: extra specular through the metal mask, so armour glints
 * - rim: a coloured rim light with a fresnel falloff, strongest facing `rimDir`
 * - glow: emissive on enchanted gear (materials flagged `userData.enchant`)
 */
export const characterStyle = {
  wrap: { value: 0.35 },
  specBoost: { value: 1.2 },
  rim: { value: 0.5 },
  rimColor: { value: new THREE.Color(0x9fc4ff) },
  rimPower: { value: 3 },
  /** Direction the rim light comes from, in view space; see {@link setRimDirection}. */
  rimDir: { value: new THREE.Vector3(0, 0.35, -1).normalize() },
  glow: { value: 1.6 },
  glowColor: { value: new THREE.Color(0x58c8ff) },
  time: { value: 0 },
};

/** The default strengths, for the on/off toggles to restore. */
export const STYLE_DEFAULTS = {
  wrap: characterStyle.wrap.value,
  specBoost: characterStyle.specBoost.value,
  rim: characterStyle.rim.value,
  glow: characterStyle.glow.value,
} as const;

const PARS = /* glsl */ `
uniform float uWrap;
uniform float uSpecBoost;
uniform float uRim;
uniform vec3 uRimColor;
uniform float uRimPower;
uniform vec3 uRimDir;
uniform float uGlow;
uniform vec3 uGlowColor;
uniform float uEnchant;
uniform float uStyleTime;
float gStyleMetal = 0.0;
`;

const GLOW = /* glsl */ `
totalEmissiveRadiance += uGlowColor * ( uGlow * uEnchant * ( 0.85 + 0.15 * sin( uStyleTime * 2.5 ) ) );
`;

const RIM = /* glsl */ `
{
	float styleFresnel = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), uRimPower );
	float styleBehind = 0.3 + 0.7 * saturate( dot( normal, uRimDir ) );
	outgoingLight += uRimColor * ( uRim * styleFresnel * styleBehind );
}
`;

/**
 * Replace exactly one occurrence, failing loudly if three's shader text has
 * moved on. Whitespace is matched loosely: the library build collapses the
 * blank lines its source chunks have.
 */
function patch(src: string, from: string, to: string): string {
  const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'g');
  const matches = src.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`characterStyle: shader chunk changed (${matches?.length ?? 0} matches): ${from.slice(0, 60)}`);
  }
  return src.replace(pattern, () => to);
}

/** The physical lighting chunk with wrap diffuse and the metal-mask specular boost. */
function physicalChunk(): string {
  let chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  chunk = patch(
    chunk,
    'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\n\tvec3 irradiance = dotNL * directLight.color;',
    [
      'float dotNLraw = dot( geometryNormal, directLight.direction );',
      '\tfloat dotNL = saturate( dotNLraw );',
      '\tvec3 irradiance = dotNL * directLight.color;',
      '\tfloat styleWrap = uWrap * ( 1.0 - gStyleMetal );',
      '\tvec3 irradianceWrap = saturate( ( dotNLraw + styleWrap ) / ( 1.0 + styleWrap ) ) * directLight.color;',
    ].join('\n'),
  );
  chunk = patch(
    chunk,
    'reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );',
    'reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material ) * ( 1.0 + uSpecBoost * gStyleMetal );',
  );
  chunk = patch(
    chunk,
    'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
    'reflectedLight.directDiffuse += irradianceWrap * BRDF_Lambert( material.diffuseColor );',
  );
  return chunk;
}

let physical: string | null = null;

/**
 * Patch a PBR material with the style pass. Idempotent; materials flagged
 * `userData.enchant` before the call pick up the glow, and a material flagged
 * `userData.perVertexEnchant` glows where its `vEnchant` varying says (the
 * merged attachments mesh). Whatever the material already did in
 * onBeforeCompile still runs, after the style pass, so it may expand the
 * chunks the pass anchors on.
 */
export function applyCharacterStyle(mat: THREE.Material): void {
  if (!(mat instanceof THREE.MeshStandardMaterial) || mat.userData.styled) return;
  mat.userData.styled = true;
  const enchant = { value: mat.userData.enchant ? 1 : 0 };
  const perVertex = mat.userData.perVertexEnchant === true;
  const own = mat.onBeforeCompile;
  const ownKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    const s = characterStyle;
    Object.assign(shader.uniforms, {
      uWrap: s.wrap,
      uSpecBoost: s.specBoost,
      uRim: s.rim,
      uRimColor: s.rimColor,
      uRimPower: s.rimPower,
      uRimDir: s.rimDir,
      uGlow: s.glow,
      uGlowColor: s.glowColor,
      uStyleTime: s.time,
      uEnchant: enchant,
    });
    physical ??= physicalChunk();
    let f = shader.fragmentShader;
    f = patch(f, '#include <common>', '#include <common>\n' + PARS);
    f = patch(f, '#include <lights_physical_pars_fragment>', physical);
    f = patch(f, '#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tgStyleMetal = metalnessFactor;');
    f = patch(f, '#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + (perVertex ? GLOW.replace('uEnchant', 'vEnchant') : GLOW));
    f = patch(f, '#include <opaque_fragment>', RIM + '#include <opaque_fragment>');
    shader.fragmentShader = f;
    own.call(mat, shader, renderer);
  };
  mat.customProgramCacheKey = () => `${ownKey.call(mat)}|aeloria-character-style-2${perVertex ? '-pv' : ''}`;
  mat.needsUpdate = true;
}

/** Patch every PBR material under `root` (a dressed rig). */
export function styleCharacter(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) applyCharacterStyle(m);
  });
}

/** Point the rim light: a world-space direction toward the light, converted for the shader. */
export function setRimDirection(worldDir: THREE.Vector3, camera: THREE.Camera): void {
  characterStyle.rimDir.value.copy(worldDir).transformDirection(camera.matrixWorldInverse);
}
