import * as THREE from 'three';

/**
 * Photographic PBR materials (colour, normal, roughness, ambient occlusion)
 * scanned by Poly Haven and released as CC0, served from `public/textures`.
 * They are what carry the game from "lit low-poly" to something that reads
 * as real ground, bark, and masonry. Every set is optional: anything that
 * fails to load (offline, missing file) simply leaves the procedural texture
 * in place, so the game never depends on an asset being present.
 */
export interface PbrMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
  aoMap?: THREE.Texture;
}

export type PhotoMaterialKey = 'grass' | 'dirt' | 'flagstone' | 'wall' | 'bark' | 'rock' | 'planks' | 'roof';

export type PhotoLibrary = Partial<Record<PhotoMaterialKey, PbrMaps>>;

const KEYS: readonly PhotoMaterialKey[] = ['grass', 'dirt', 'flagstone', 'wall', 'bark', 'rock', 'planks', 'roof'];

/** Load every photo material that exists under `base`; missing ones are skipped. */
export async function loadPhotoLibrary(base = '/textures'): Promise<PhotoLibrary> {
  const loader = new THREE.TextureLoader();
  const load = (url: string, srgb: boolean): Promise<THREE.Texture | null> =>
    new Promise((resolve) => {
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = 8;
          resolve(tex);
        },
        undefined,
        () => resolve(null),
      );
    });

  const lib: PhotoLibrary = {};
  await Promise.all(
    KEYS.map(async (key) => {
      const [map, normalMap, roughnessMap, aoMap] = await Promise.all([
        load(`${base}/${key}/diff.jpg`, true),
        load(`${base}/${key}/nor.jpg`, false),
        load(`${base}/${key}/rough.jpg`, false),
        load(`${base}/${key}/ao.jpg`, false),
      ]);
      if (!map || !normalMap) return;
      if (aoMap) aoMap.channel = 0; // read AO through the ordinary uv set
      lib[key] = { map, normalMap, roughnessMap: roughnessMap ?? undefined, aoMap: aoMap ?? undefined };
    }),
  );
  return lib;
}

/** Apply a photo set to a standard material, keeping whatever it already had as the fallback. */
export function applyPbr(material: THREE.MeshStandardMaterial, maps: PbrMaps | undefined): THREE.MeshStandardMaterial {
  if (!maps) return material;
  material.map = maps.map;
  material.normalMap = maps.normalMap;
  if (maps.roughnessMap) {
    material.roughnessMap = maps.roughnessMap;
    material.roughness = 1;
  }
  if (maps.aoMap) {
    material.aoMap = maps.aoMap;
    material.aoMapIntensity = 0.8;
  }
  material.needsUpdate = true;
  return material;
}
