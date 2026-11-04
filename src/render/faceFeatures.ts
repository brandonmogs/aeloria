import * as THREE from 'three';
import { LidMargin, Rig, SkinField } from './characters';
import { Builder, strandMaterial } from './hair';

/**
 * The small hair of the face: eyebrows as ribbons laid on the skin above the
 * eyes, and eyelashes as curled strands along the edges of the lids, both on
 * the strand material so they thin into wisps. They hang on the head bone
 * beside the eyes and stay put under a helmet. Both are placed by reading the
 * finished head itself (see FaceField), so they follow every slider.
 */

const smooth = (x: number, a: number, b: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The skin round one eye as seen from the front: a grid over the face plane,
 * in eyeball radii about the globe's centre, holding the nearest surface's
 * depth in each cell. Built once per eye from the finished mesh, it answers
 * where the skin is under a point (for the brows) and where the lids' edges
 * run (for the lashes). `shift` takes the mesh into the head bone's space,
 * where `eye` and every result live; `sign` is 1 for the left eye, whose
 * inner corner lies toward -x, and -1 for the right.
 */
export class FaceField implements SkinField {
  private static readonly CELL = 0.05;
  private static readonly U0 = -2.6;
  private static readonly U1 = 2.9;
  private static readonly V0 = -1.8;
  private static readonly V1 = 3.6;
  private readonly W: number;
  private readonly H: number;
  private readonly depth: Float32Array;

  constructor(pos: Float32Array, indices: ArrayLike<number>, shift: THREE.Vector3, readonly eye: THREE.Vector3, readonly r: number, readonly sign: number) {
    const { CELL, U0, U1, V0, V1 } = FaceField;
    this.W = Math.round((U1 - U0) / CELL);
    this.H = Math.round((V1 - V0) / CELL);
    const W = this.W;
    const H = this.H;
    const depth = new Float32Array(W * H).fill(-Infinity);
    const inv = 1 / r;
    const ox = shift.x + eye.x;
    const oy = shift.y + eye.y;
    const oz = shift.z + eye.z;
    const u = [0, 0, 0];
    const v = [0, 0, 0];
    const w = [0, 0, 0];
    for (let t = 0; t < indices.length; t += 3) {
      let skip = false;
      for (let k = 0; k < 3 && !skip; k++) {
        const i = indices[t + k] * 3;
        u[k] = sign * (pos[i] - ox) * inv;
        v[k] = (pos[i + 1] - oy) * inv;
        w[k] = (pos[i + 2] - oz) * inv;
        if (u[k] < U0 - 0.6 || u[k] > U1 + 0.6 || v[k] < V0 - 0.6 || v[k] > V1 + 0.6 || w[k] < -3 || w[k] > 4) skip = true;
      }
      if (skip) continue;
      const det = (u[1] - u[0]) * (v[2] - v[0]) - (u[2] - u[0]) * (v[1] - v[0]);
      if (Math.abs(det) < 1e-9) continue;
      const i0 = Math.max(0, Math.floor((Math.min(u[0], u[1], u[2]) - U0) / CELL - 0.5));
      const i1 = Math.min(W - 1, Math.ceil((Math.max(u[0], u[1], u[2]) - U0) / CELL - 0.5));
      const j0 = Math.max(0, Math.floor((Math.min(v[0], v[1], v[2]) - V0) / CELL - 0.5));
      const j1 = Math.min(H - 1, Math.ceil((Math.max(v[0], v[1], v[2]) - V0) / CELL - 0.5));
      for (let j = j0; j <= j1; j++) {
        const cv = V0 + (j + 0.5) * CELL;
        for (let i = i0; i <= i1; i++) {
          const cu = U0 + (i + 0.5) * CELL;
          const lb = ((cu - u[0]) * (v[2] - v[0]) - (u[2] - u[0]) * (cv - v[0])) / det;
          const lc = ((u[1] - u[0]) * (cv - v[0]) - (cu - u[0]) * (v[1] - v[0])) / det;
          const la = 1 - lb - lc;
          if (la < -1e-4 || lb < -1e-4 || lc < -1e-4) continue;
          const d = la * w[0] + lb * w[1] + lc * w[2];
          if (d > depth[j * W + i]) depth[j * W + i] = d;
        }
      }
    }
    this.depth = depth;
  }

  /** The cell's depth, clamped to the grid. */
  private at(i: number, j: number): number {
    return this.depth[Math.min(this.H - 1, Math.max(0, j)) * this.W + Math.min(this.W - 1, Math.max(0, i))];
  }

  /** Depth under a grid point (eyeball radii about the globe's centre) by bilinear interpolation; -Infinity where the mesh is absent. */
  depthAt(u: number, v: number): number {
    const { CELL, U0, V0 } = FaceField;
    const x = (u - U0) / CELL - 0.5;
    const y = (v - V0) / CELL - 0.5;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const d00 = this.at(i, j);
    const d10 = this.at(i + 1, j);
    const d01 = this.at(i, j + 1);
    const d11 = this.at(i + 1, j + 1);
    if (!isFinite(d00) || !isFinite(d10) || !isFinite(d01) || !isFinite(d11)) return Math.max(d00, d10, d01, d11);
    return (d00 * (1 - fx) + d10 * fx) * (1 - fy) + (d01 * (1 - fx) + d11 * fx) * fy;
  }

  surface(x: number, y: number, point: THREE.Vector3, normal: THREE.Vector3): boolean {
    const { eye, r, sign } = this;
    const u = (sign * (x - eye.x)) / r;
    const v = (y - eye.y) / r;
    const d = this.depthAt(u, v);
    if (!isFinite(d)) return false;
    point.set(x, y, eye.z + d * r);
    // The slope of the depth gives the normal; the grid's u runs opposite to x on the right eye.
    const h = FaceField.CELL;
    const du = (this.depthAt(u + h, v) - this.depthAt(u - h, v)) / (2 * h);
    const dv = (this.depthAt(u, v + h) - this.depthAt(u, v - h)) / (2 * h);
    if (!isFinite(du) || !isFinite(dv)) normal.set(0, 0, 1);
    else normal.set(-sign * du, -dv, 1).normalize();
    return true;
  }

  /**
   * The edge of the eye's opening: every column of cells is either the lid or
   * the socket behind it, and the margin is the step between them. The runs go
   * from the inner corner to the outer; null when there is no opening.
   */
  lidMargin(): LidMargin | null {
    const { CELL, U0, V0 } = FaceField;
    const { W, H, eye, r, sign } = this;
    // Walking out from the deepest cell near the globe's centre line, the
    // margin is the first sharp rise onto a surface ahead of the globe's
    // equator: the lid's edge, not the slope of the socket's floor.
    const STEP = 0.2;
    const jc = Math.floor((0 - V0) / CELL);
    const columns: Array<{ ju: number; jl: number } | null> = [];
    for (let i = 0; i < W; i++) {
      let js = jc;
      let deepest = this.at(i, jc);
      for (let j = jc - 10; j <= jc + 10; j++) {
        if (this.at(i, j) < deepest) {
          deepest = this.at(i, j);
          js = j;
        }
      }
      const edge = (dir: number): number => {
        let prev = deepest;
        for (let j = js + dir; j >= 0 && j < H; j += dir) {
          const d = this.at(i, j);
          if (d - prev >= STEP && d >= 0.85 && d >= deepest + 0.4) return j;
          prev = d;
        }
        return -1;
      };
      const ju = deepest < 1 ? edge(1) : -1;
      const jl = deepest < 1 ? edge(-1) : -1;
      columns.push(ju >= 0 && jl >= 0 ? { ju, jl } : null);
    }
    // The longest unbroken run of open columns is the eye; stray cells at the tear duct are not.
    let best: [number, number] = [0, -1];
    for (let i = 0; i < W; i++) {
      if (!columns[i]) continue;
      let k = i;
      while (k + 1 < W && columns[k + 1]) k++;
      if (k - i > best[1] - best[0]) best = [i, k];
      i = k;
    }
    if (best[1] - best[0] < 8) return null;
    const point = (i: number, j: number, out: number): THREE.Vector3 => {
      // The anchor is the front corner of the margin: the nearer of the step cell and the one beyond it.
      const d = Math.max(this.at(i, j), this.at(i, j + out));
      return new THREE.Vector3(eye.x + sign * (U0 + (i + 0.5) * CELL) * r, eye.y + (V0 + (j + 0.5) * CELL) * r, eye.z + d * r);
    };
    const upper: THREE.Vector3[] = [];
    const lower: THREE.Vector3[] = [];
    for (let i = best[0]; i <= best[1]; i++) {
      const c = columns[i]!;
      upper.push(point(i, c.ju, 1));
      lower.push(point(i, c.jl, -1));
    }
    // Smooth the cell steps out of each run.
    for (const run of [upper, lower]) {
      const src = run.map((p) => p.clone());
      for (let k = 1; k < run.length - 1; k++) {
        run[k].y = (src[k - 1].y + 2 * src[k].y + src[k + 1].y) / 4;
        run[k].z = (src[k - 1].z + 2 * src[k].z + src[k + 1].z) / 4;
      }
    }
    return { upper, lower };
  }
}

/** A small deterministic scatter for strand placement. */
const jitter = (k: number): number => {
  const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Both eyebrows. `weight` runs from 0 (a fine line) to 1 (heavy); the ribbon
 * runs along the painted brow's arch, laid on the skin it finds there and
 * lifted a touch off it, peaking past its middle and tapering into a tail at
 * the temple. Its edges feather out through the vertex alpha, so it reads as
 * strands over the painted brow rather than a bar.
 */
export function buildBrows(rig: Rig, color: number, weight: number): THREE.Object3D | null {
  const f = rig.dims.face;
  if (!f?.browPoints || f.browPoints.length < 2 || !f.eyeL || !f.eyeR || !f.skinL || !f.skinR) return null;
  const K = f.headScale ?? rig.dims.scale;
  const b = new Builder();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const side = new THREE.Vector3();
  const q = new THREE.Vector3();
  const xIn = Math.abs(f.browPoints[0].x) - 0.003 * K;
  const xOut = Math.abs(f.browPoints[f.browPoints.length - 1].x) + 0.006 * K;
  for (const [eye, skin, sign] of [[f.eyeL, f.skinL, 1], [f.eyeR, f.skinR, -1]] as const) {
    const M = 16;
    let prev: [number, number, number] | null = null;
    // The painted brow's arch: up past the middle, down into the tail.
    const arch = (t: number): number => eye.y + (0.02 + 0.006 * Math.sin(Math.PI * Math.min(1, t * 1.15)) - 0.003 * smooth(t, 0.8, 1)) * K;
    // A narrow patch of the strand texture's middle, where it is opaque, so its streaks run along the brow and only the vertex alpha shapes it.
    const u0 = sign > 0 ? 0.2 : 0.55;
    for (let i = 0; i <= M; i++) {
      const t = i / M;
      const x = sign * (xIn + (xOut - xIn) * t);
      if (!skin.surface(x, arch(t), p, n)) continue;
      const t2 = Math.min(1, t + 0.02);
      if (!skin.surface(sign * (xIn + (xOut - xIn) * t2), arch(t2), ahead, q)) continue;
      tan.subVectors(ahead, p).normalize();
      side.crossVectors(n, tan).normalize();
      p.addScaledVector(n, 0.0012 * K);
      const w = (0.008 + 0.004 * weight) * K * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.25))) * (1 - 0.6 * smooth(t, 0.65, 1));
      const alpha = (0.8 + 0.2 * weight) * (1 - smooth(t, 0.72, 1)) * smooth(t, 0, 0.12);
      const shade = 0.8 + 0.15 * Math.sin(t * 9);
      const v = 0.44 + 0.12 * t;
      const l = b.vertex(q.copy(p).addScaledVector(side, -w / 2), n, u0, v, shade, 0);
      const c = b.vertex(p, n, u0 + 0.04, v, shade, alpha);
      const r = b.vertex(q.copy(p).addScaledVector(side, w / 2), n, u0 + 0.08, v, shade, 0);
      if (prev) {
        b.quad(prev[0], l, c, prev[1]);
        b.quad(prev[1], c, r, prev[2]);
      }
      prev = [l, c, r];
    }
  }
  const geo = b.build();
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, strandMaterial(color));
  mesh.name = 'brows';
  mesh.castShadow = false;
  mesh.userData.noAO = true;
  return mesh;
}

/**
 * Eyelashes: fine curled strands along the upper lid, leaving the lid's front
 * the way its skin faces, then curling up and, toward the outer corner,
 * outward; and a shorter, sparser, paler row along the lower lid. `length` is
 * the upper lashes' in metres (already scaled to the figure); 0 builds none,
 * as does a head whose lids were not found.
 */
export function buildLashes(rig: Rig, length: number): THREE.Object3D | null {
  const f = rig.dims.face;
  if (!f?.lidL || !f.lidR || !f.skinL || !f.skinR || !f.eyeRadius || length <= 0) return null;
  const r = f.eyeRadius;
  const b = new Builder();
  const base = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const d1 = new THREE.Vector3();
  const d2 = new THREE.Vector3();
  const d3 = new THREE.Vector3();
  const s1 = new THREE.Vector3();
  const s2 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const q = new THREE.Vector3();
  const fan = (run: THREE.Vector3[], skin: SkinField, sign: number, count: number, len: number, lower: boolean): void => {
    if (run.length < 4) return;
    const curve = new THREE.CatmullRomCurve3(run, false, 'centripetal', 0.5);
    const w = (lower ? 0.02 : 0.03) * r;
    const up = lower ? -1 : 1;
    for (let i = 0; i < count; i++) {
      const seed = i * 7 + (lower ? 300 : 0) + (sign > 0 ? 0 : 150);
      // Along the lid from the inner corner, where lashes are sparse and short, to the outer, a little unevenly.
      const t = (lower ? 0.2 + (0.72 * (i + 0.5)) / count : 0.1 + (0.88 * (i + 0.5)) / count) + (jitter(seed) - 0.5) * (0.5 / count);
      curve.getPointAt(t, base);
      curve.getTangentAt(t, tan);
      // The lid's front just beyond the margin gives the root its direction.
      if (!skin.surface(base.x, base.y + up * 0.2 * r, q, nrm)) nrm.set(0, 0, 1);
      const profile = lower ? 0.6 + 0.4 * Math.sin(Math.PI * t) : 0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.12));
      const L = len * profile * (0.85 + 0.3 * jitter(seed + 1));
      const lean = sign * (lower ? 0.15 : 0.1 + 0.6 * Math.max(0, t - 0.4)) + (jitter(seed + 2) - 0.5) * 0.3;
      const curl = 0.85 + 0.3 * jitter(seed + 3);
      d1.copy(nrm).add(q.set(lean * 0.4, up * 0.05, 0.2)).normalize();
      d2.copy(nrm).multiplyScalar(0.7).add(q.set(lean, up * 0.6 * curl, 0.3)).normalize();
      d3.set(lean * 1.2, up * curl, 0.45 + 0.2 * nrm.z).normalize();
      base.addScaledVector(d1, -0.06 * r); // rooted just inside the lid
      n.crossVectors(tan, d1).normalize();
      if (n.z < 0) n.negate();
      // Each strand reads its own column of the strand texture's opaque middle; the vertex alpha thins it to a point.
      const u0 = jitter(seed + 4) * 0.9;
      const shade = lower ? 0.7 : 0.5 + 0.15 * jitter(seed + 5);
      const ring = (point: THREE.Vector3, k: number, v: number, alpha: number): [number, number] => [
        b.vertex(q.copy(point).addScaledVector(tan, -w * k), n, u0, v, shade, alpha),
        b.vertex(q.copy(point).addScaledVector(tan, w * k), n, u0 + 0.03, v, shade, alpha),
      ];
      const a = ring(base, 1, 0.44, 1);
      const m1 = ring(s1.copy(base).addScaledVector(d1, 0.3 * L), 0.85, 0.48, 0.95);
      const m2 = ring(s2.copy(s1).addScaledVector(d2, 0.4 * L), 0.6, 0.52, 0.7);
      const tip = ring(s3.copy(s2).addScaledVector(d3, 0.3 * L), 0.3, 0.56, 0.25);
      b.quad(a[0], a[1], m1[1], m1[0]);
      b.quad(m1[0], m1[1], m2[1], m2[0]);
      b.quad(m2[0], m2[1], tip[1], tip[0]);
    }
  };
  for (const [lid, skin, sign] of [[f.lidL, f.skinL, 1], [f.lidR, f.skinR, -1]] as const) {
    fan(lid.upper, skin, sign, 14, length, false);
    fan(lid.lower, skin, sign, 5, length * 0.3, true);
  }
  const geo = b.build();
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, strandMaterial(0x1a120e));
  mesh.name = 'lashes';
  mesh.castShadow = false;
  mesh.userData.noAO = true;
  return mesh;
}
