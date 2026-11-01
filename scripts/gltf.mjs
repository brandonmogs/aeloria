// A small glTF 2.0 / GLB writer for the character build: accessors, skinned
// meshes, joint hierarchies, animations and extras. Written from the spec
// rather than taken from an exporter so the build can run in plain Node.
// https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html

const COMPONENT = {
  Float32Array: 5126,
  Uint32Array: 5125,
  Uint16Array: 5123,
  Uint8Array: 5121,
};

/** Builds one glTF document and serialises it as a GLB buffer. */
export class GltfBuilder {
  constructor(generator = 'aeloria build') {
    this.json = {
      asset: { version: '2.0', generator },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      skins: [],
      accessors: [],
      bufferViews: [],
      buffers: [],
      animations: [],
    };
    this.chunks = [];
    this.byteLength = 0;
  }

  /** Append a typed array as a buffer view + accessor; returns the accessor index. */
  accessor(array, type, { target, minMax = false, normalized = false } = {}) {
    const componentType = COMPONENT[array.constructor.name];
    if (!componentType) throw new Error(`unsupported array ${array.constructor.name}`);
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.byteLength += pad;
    }
    const view = { buffer: 0, byteOffset: this.byteLength, byteLength: array.byteLength };
    if (target) view.target = target;
    this.chunks.push(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    this.byteLength += array.byteLength;
    this.json.bufferViews.push(view);
    const acc = { bufferView: this.json.bufferViews.length - 1, componentType, count: array.length / size, type };
    if (normalized) acc.normalized = true;
    if (minMax) {
      const min = new Array(size).fill(Infinity);
      const max = new Array(size).fill(-Infinity);
      for (let i = 0; i < array.length; i++) {
        const k = i % size;
        if (array[i] < min[k]) min[k] = array[i];
        if (array[i] > max[k]) max[k] = array[i];
      }
      acc.min = min;
      acc.max = max;
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }

  /** Add a node; returns its index. `parent` (an index) adopts it, else it goes in the scene. */
  node({ name, translation, rotation, scale, parent, extras }) {
    const node = { name };
    if (translation) node.translation = translation;
    if (rotation) node.rotation = rotation;
    if (scale) node.scale = scale;
    if (extras) node.extras = extras;
    this.json.nodes.push(node);
    const index = this.json.nodes.length - 1;
    if (parent === undefined || parent === null) this.json.scenes[0].nodes.push(index);
    else (this.json.nodes[parent].children ??= []).push(index);
    return index;
  }

  /**
   * A triangle mesh with the given attributes (name -> typed array, e.g.
   * POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0) and an index array.
   * Returns the mesh index.
   */
  mesh(name, attributes, indices, { material, extras } = {}) {
    const attrs = {};
    for (const [key, array] of Object.entries(attributes)) {
      const type = key === 'TEXCOORD_0' ? 'VEC2' : key === 'JOINTS_0' || key === 'WEIGHTS_0' ? 'VEC4' : 'VEC3';
      attrs[key] = this.accessor(array, type, { target: 34962, minMax: key === 'POSITION' });
    }
    const primitive = { attributes: attrs, indices: this.accessor(indices, 'SCALAR', { target: 34963 }), mode: 4 };
    if (material !== undefined) primitive.material = material;
    const mesh = { name, primitives: [primitive] };
    if (extras) mesh.extras = extras;
    this.json.meshes.push(mesh);
    return this.json.meshes.length - 1;
  }

  /** A skin over `joints` (node indices) with their inverse bind matrices (column-major 4x4 each). */
  skin(name, joints, inverseBindMatrices, skeleton) {
    const skin = { name, joints, inverseBindMatrices: this.accessor(inverseBindMatrices, 'MAT4') };
    if (skeleton !== undefined) skin.skeleton = skeleton;
    this.json.skins.push(skin);
    return this.json.skins.length - 1;
  }

  /**
   * An animation: `channels` is a list of { node, path: 'rotation'|'translation', times: Float32Array, values: Float32Array }.
   */
  animation(name, channels) {
    const anim = { name, samplers: [], channels: [] };
    for (const c of channels) {
      const input = this.accessor(c.times, 'SCALAR', { minMax: true });
      const output = this.accessor(c.values, c.path === 'rotation' ? 'VEC4' : 'VEC3');
      anim.samplers.push({ input, output, interpolation: 'LINEAR' });
      anim.channels.push({ sampler: anim.samplers.length - 1, target: { node: c.node, path: c.path } });
    }
    this.json.animations.push(anim);
    return this.json.animations.length - 1;
  }

  material(name, { color = [1, 1, 1, 1], metallic = 0, roughness = 0.8 } = {}) {
    (this.json.materials ??= []).push({ name, pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: metallic, roughnessFactor: roughness } });
    return this.json.materials.length - 1;
  }

  /** The finished GLB (header, JSON chunk, BIN chunk) as a Buffer. */
  toGlb() {
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.byteLength += pad;
    }
    this.json.buffers = [{ byteLength: this.byteLength }];
    if (!this.json.animations.length) delete this.json.animations;
    if (!this.json.skins.length) delete this.json.skins;
    // The JSON chunk is padded with spaces to a multiple of four BYTES (not characters) so the BIN chunk stays aligned.
    let jsonBytes = Buffer.from(JSON.stringify(this.json), 'utf8');
    const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
    if (jsonPad) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
    const bin = Buffer.concat(this.chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
    const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
    const out = Buffer.alloc(total);
    let o = 0;
    out.writeUInt32LE(0x46546c67, o); // 'glTF'
    out.writeUInt32LE(2, o + 4);
    out.writeUInt32LE(total, o + 8);
    o += 12;
    out.writeUInt32LE(jsonBytes.length, o);
    out.writeUInt32LE(0x4e4f534a, o + 4); // 'JSON'
    jsonBytes.copy(out, o + 8);
    o += 8 + jsonBytes.length;
    out.writeUInt32LE(bin.length, o);
    out.writeUInt32LE(0x004e4942, o + 4); // 'BIN\0'
    bin.copy(out, o + 8);
    return out;
  }
}
