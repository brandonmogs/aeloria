/**
 * A minimal GLB reader for the character files the build script writes: the
 * JSON chunk, the binary chunk, and typed-array views of accessors. Only what
 * those files use (one buffer, tightly packed attributes) is supported; it
 * keeps the loader free of a scene-graph walk the renderer would then undo.
 */

export interface GlbAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  normalized?: boolean;
}

export interface GlbNode {
  name: string;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  children?: number[];
  mesh?: number;
  skin?: number;
  extras?: Record<string, unknown>;
}

export interface GlbJson {
  asset: { version: string; extras?: Record<string, unknown> };
  scenes: Array<{ nodes: number[] }>;
  nodes: GlbNode[];
  meshes: Array<{ name: string; primitives: Array<{ attributes: Record<string, number>; indices: number }>; extras?: Record<string, unknown> }>;
  skins?: Array<{ name: string; joints: number[]; inverseBindMatrices: number }>;
  accessors: GlbAccessor[];
  bufferViews: Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }>;
  animations?: Array<{ name: string }>;
}

export interface Glb {
  json: GlbJson;
  bin: ArrayBuffer;
  binOffset: number;
}

const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as const;

export function parseGlb(buffer: ArrayBuffer): Glb {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  let offset = 12;
  let json: GlbJson | null = null;
  let bin: { offset: number; length: number } | null = null;
  while (offset < buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length))) as GlbJson;
    else if (type === 0x004e4942) bin = { offset: start, length };
    offset = start + length;
  }
  if (!json || !bin) throw new Error('GLB is missing its JSON or BIN chunk');
  return { json, bin: buffer, binOffset: bin.offset };
}

type Typed = Float32Array | Uint32Array | Uint16Array | Uint8Array;

/** A typed array over an accessor's data (a view when packed, a copy otherwise). */
export function readAccessor(glb: Glb, index: number): Typed {
  const acc = glb.json.accessors[index];
  const bv = glb.json.bufferViews[acc.bufferView];
  const size = SIZE[acc.type];
  const start = glb.binOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const length = acc.count * size;
  const Ctor = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[acc.componentType];
  if (!Ctor) throw new Error(`unsupported accessor component type ${acc.componentType}`);
  // A view when the data is aligned for its element size, a copy otherwise.
  if (start % Ctor.BYTES_PER_ELEMENT === 0) return new Ctor(glb.bin, start, length);
  return new Ctor(glb.bin.slice(start, start + length * Ctor.BYTES_PER_ELEMENT));
}

export function readFloat(glb: Glb, index: number): Float32Array {
  const a = readAccessor(glb, index);
  return a instanceof Float32Array ? a : Float32Array.from(a);
}

export function readUint16(glb: Glb, index: number): Uint16Array {
  const a = readAccessor(glb, index);
  return a instanceof Uint16Array ? a : Uint16Array.from(a);
}

export function readUint32(glb: Glb, index: number): Uint32Array {
  const a = readAccessor(glb, index);
  return a instanceof Uint32Array ? a : Uint32Array.from(a);
}
