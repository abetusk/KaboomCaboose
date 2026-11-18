// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Minimal MagicaVoxel (.vox) reading and writing, enough for single-model
// assets. Files written here open in Goxel and MagicaVoxel.
//
// A model is a dense grid of palette indices (0 = empty) with its own
// 256-entry RGBA palette. Axes: x, y horizontal, z up.
//

import { readFileSync, writeFileSync } from "node:fs";

export type RGBA = [number, number, number, number];

export class VoxModel {
  sx  : number;
  sy  : number;
  sz  : number;
  v   : Uint8Array;
  pal : RGBA[];

  constructor(sx: number, sy: number, sz: number, pal: RGBA[] = defaultPalette()) {
    this.sx  = sx;
    this.sy  = sy;
    this.sz  = sz;
    this.v   = new Uint8Array(sx * sy * sz);
    this.pal = pal;
  }

  inside(x: number, y: number, z: number): boolean {
    return ( (x >= 0) && (x < this.sx) && (y >= 0) && (y < this.sy) && (z >= 0) && (z < this.sz) );
  }

  get(x: number, y: number, z: number): number {
    return ( this.inside(x, y, z) ? this.v[x + (this.sx * (y + (this.sy * z)))] : 0 );
  }

  set(x: number, y: number, z: number, c: number): void {
    if (this.inside(x, y, z)) { this.v[x + (this.sx * (y + (this.sy * z)))] = c; }
  }

  count(): number {
    let n = 0;
    for (let i = 0; i < this.v.length; i++) { if (this.v[i]) { n++; } }
    return n;
  }
}

// A grey ramp palette; callers normally supply their own.
//
export function defaultPalette(): RGBA[] {
  const p = [] as RGBA[];
  for (let i = 0; i < 256; i++) { p.push([i, i, i, 255]); }
  return p;
}

// Read a .vox file, with its palette. A file may hold several models
// (Kytric's vehicles keep a few detail voxels in a second model); all
// models must have the same size and are merged into one. Scene graph
// transforms are ignored, so this is only correct when every model shares
// one transform, as in Kytric's files.
//
export function readVox(path: string): VoxModel {
  const d = readFileSync(path);
  if (d.toString("ascii", 0, 4) !== "VOX ") { throw new Error(path + ": not a .vox file"); }
  let size: [number, number, number] | null = null,
      pal:  RGBA[] | null = null;
  const parts = [] as Buffer[];
  const walk = (i: number, end: number) => {
    while (i < end) {
      const id = d.toString("ascii", i, i + 4),
            n  = d.readInt32LE(i + 4),
            m  = d.readInt32LE(i + 8),
            b  = i + 12;
      if      (id === "MAIN") { walk(b + n, b + n + m); }
      else if (id === "SIZE") {
        const sz: [number, number, number] = [d.readInt32LE(b), d.readInt32LE(b + 4), d.readInt32LE(b + 8)];
        if ( size && ( (size[0] !== sz[0]) || (size[1] !== sz[1]) || (size[2] !== sz[2]) ) ) {
          throw new Error(path + ": models of different sizes are not supported");
        }
        size = sz;
      }
      else if (id === "XYZI") { parts.push(d.subarray(b, b + n)); }
      else if (id === "RGBA") {
        pal = [[0, 0, 0, 0]];
        for (let k = 0; k < 255; k++) {
          pal.push([d[b + (4 * k)], d[b + (4 * k) + 1], d[b + (4 * k) + 2], d[b + (4 * k) + 3]]);
        }
      }
      i = b + n + m;
    }
  };
  walk(8, d.length);
  if ( !size || !parts.length ) { throw new Error(path + ": no model"); }
  const [sx, sy, sz] = size as [number, number, number],
        mdl = new VoxModel(sx, sy, sz, pal ?? defaultPalette());
  for (const xb of parts) {
    const n = xb.readInt32LE(0);
    for (let k = 0; k < n; k++) {
      const o = 4 + (4 * k);
      mdl.set(xb[o], xb[o + 1], xb[o + 2], xb[o + 3]);
    }
  }
  return mdl;
}

// One placed shape of a .vox scene: its node name (from the transform
// node above it), the model, and where it sits in the scene.
//
export interface SceneShape {
  name  : string;
  model : VoxModel;
  rot   : number[][];
  t     : [number, number, number];
}

// Decode MagicaVoxel's packed rotation byte into a 3x3 matrix. Bits 0-1
// give the column of row 0's non-zero entry, bits 2-3 that of row 1 (row
// 2 takes the remaining column); bits 4, 5, 6 make rows 0, 1, 2 negative.
//
function rotation(r: number): number[][] {
  const c0 = r & 3, c1 = (r >> 2) & 3, c2 = 3 - c0 - c1,
        m  = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  m[0][c0] = ( (r & 16) ? -1 : 1 );
  m[1][c1] = ( (r & 32) ? -1 : 1 );
  m[2][c2] = ( (r & 64) ? -1 : 1 );
  return m;
}

const mul  = (a: number[][], b: number[][]) => a.map(row => [0, 1, 2].map(j => (row[0] * b[0][j]) + (row[1] * b[1][j]) + (row[2] * b[2][j])));
const mulv = (a: number[][], v: number[]) => a.map(row => (row[0] * v[0]) + (row[1] * v[1]) + (row[2] * v[2]));

// Read a .vox scene: every shape with its accumulated transform. Only the
// first frame of each node and the first model of each shape are used.
//
export function readVoxScene(path: string): SceneShape[] {
  const d = readFileSync(path);
  if (d.toString("ascii", 0, 4) !== "VOX ") { throw new Error(path + ": not a .vox file"); }
  const sizes  = [] as [number, number, number][],
        voxels = [] as Buffer[],
        nodes  = new Map<number, { kind: string, attr: Record<string, string>, frame: Record<string, string>, kids: number[] }>();
  let pal: RGBA[] | null = null;

  const dict = (o: number): [Record<string, string>, number] => {
    const n = d.readInt32LE(o), r: Record<string, string> = {};
    o += 4;
    for (let k = 0; k < n; k++) {
      const kl = d.readInt32LE(o), key = d.toString("utf8", o + 4, o + 4 + kl);
      o += 4 + kl;
      const vl = d.readInt32LE(o);
      r[key] = d.toString("utf8", o + 4, o + 4 + vl);
      o += 4 + vl;
    }
    return [r, o];
  };

  for (let i = 20; i < d.length; ) {
    const id = d.toString("ascii", i, i + 4), n = d.readInt32LE(i + 4), m = d.readInt32LE(i + 8), b = i + 12;
    if      (id === "SIZE") { sizes.push([d.readInt32LE(b), d.readInt32LE(b + 4), d.readInt32LE(b + 8)]); }
    else if (id === "XYZI") { voxels.push(d.subarray(b, b + n)); }
    else if (id === "RGBA") {
      pal = [[0, 0, 0, 0]];
      for (let k = 0; k < 255; k++) { pal.push([d[b + (4 * k)], d[b + (4 * k) + 1], d[b + (4 * k) + 2], d[b + (4 * k) + 3]]); }
    }
    else if (id === "nTRN") {
      const [attr, o] = dict(b + 4),
            child     = d.readInt32LE(o),
            [frame]   = dict(o + 16);
      nodes.set(d.readInt32LE(b), { kind: "T", attr, frame, kids: [child] });
    }
    else if (id === "nGRP") {
      const [attr, o] = dict(b + 4), nk = d.readInt32LE(o), kids = [] as number[];
      for (let k = 0; k < nk; k++) { kids.push(d.readInt32LE(o + 4 + (4 * k))); }
      nodes.set(d.readInt32LE(b), { kind: "G", attr, frame: {}, kids });
    }
    else if (id === "nSHP") {
      const [attr, o] = dict(b + 4);
      nodes.set(d.readInt32LE(b), { kind: "S", attr, frame: {}, kids: [d.readInt32LE(o + 4)] });
    }
    i = b + n + m;
  }

  const model = (k: number) => {
    const [sx, sy, sz] = sizes[k], mdl = new VoxModel(sx, sy, sz, pal ?? defaultPalette()), xb = voxels[k], n = xb.readInt32LE(0);
    for (let j = 0; j < n; j++) { const o = 4 + (4 * j); mdl.set(xb[o], xb[o + 1], xb[o + 2], xb[o + 3]); }
    return mdl;
  };

  // A file without a scene graph is one shape at the origin.
  //
  if (!nodes.size) {
    return sizes.map((_, k) => ({ name: "", model: model(k), rot: rotation(4), t: [0, 0, 0] as [number, number, number] }));
  }

  const out = [] as SceneShape[];
  const walk = (id: number, rot: number[][], t: number[], name: string) => {
    const nd = nodes.get(id);
    if (!nd) { return; }
    if (nd.kind === "T") {
      const r  = ( (nd.frame._r !== undefined) ? rotation(Number(nd.frame._r)) : rotation(4) ),
            tt = ( (nd.frame._t !== undefined) ? nd.frame._t.split(" ").map(Number) : [0, 0, 0] ),
            wt = mulv(rot, tt);
      walk(nd.kids[0], mul(rot, r), [t[0] + wt[0], t[1] + wt[1], t[2] + wt[2]], nd.attr._name ?? name);
    }
    else if (nd.kind === "G") { for (const k of nd.kids) { walk(k, rot, t, name); } }
    else { out.push({ name, model: model(nd.kids[0]), rot, t: [t[0], t[1], t[2]] }); }
  };
  walk(0, rotation(4), [0, 0, 0], "");
  return out;
}

// Merge scene shapes into one model, placed as MagicaVoxel does: a shape's
// voxel v lands at rot * (v - floor(size / 2)) + t. The result is
// cropped to the occupied box.
//
export function bakeScene(shapes: SceneShape[]): VoxModel {
  const pts = [] as [number, number, number, number][];
  for (const s of shapes) {
    const m = s.model, h = [Math.floor(m.sx / 2), Math.floor(m.sy / 2), Math.floor(m.sz / 2)];
    for (let z = 0; z < m.sz; z++) {
      for (let y = 0; y < m.sy; y++) {
        for (let x = 0; x < m.sx; x++) {
          const c = m.get(x, y, z);
          if (!c) { continue; }
          const w = mulv(s.rot, [x - h[0], y - h[1], z - h[2]]);
          pts.push([w[0] + s.t[0], w[1] + s.t[1], w[2] + s.t[2], c]);
        }
      }
    }
  }
  if (!pts.length) { throw new Error("empty scene selection"); }
  const lo = [0, 1, 2].map(k => Math.min(...pts.map(p => p[k]))),
        hi = [0, 1, 2].map(k => Math.max(...pts.map(p => p[k]))),
        out = new VoxModel((hi[0] - lo[0]) + 1, (hi[1] - lo[1]) + 1, (hi[2] - lo[2]) + 1, shapes[0].model.pal);
  for (const [x, y, z, c] of pts) { out.set(x - lo[0], y - lo[1], z - lo[2], c); }
  return out;
}

function chunk(id: string, content: Buffer, children: Buffer = Buffer.alloc(0)): Buffer {
  const h = Buffer.alloc(12);
  h.write(id, 0, "ascii");
  h.writeInt32LE(content.length, 4);
  h.writeInt32LE(children.length, 8);
  return Buffer.concat([h, content, children]);
}

export function writeVox(path: string, m: VoxModel): void {
  if ( (m.sx > 256) || (m.sy > 256) || (m.sz > 256) ) { throw new Error("model larger than 256 in some axis"); }
  const n    = m.count(),
        xyzi = Buffer.alloc(4 + (4 * n));
  xyzi.writeInt32LE(n, 0);
  let o = 4;
  for (let z = 0; z < m.sz; z++) {
    for (let y = 0; y < m.sy; y++) {
      for (let x = 0; x < m.sx; x++) {
        const c = m.get(x, y, z);
        if (!c) { continue; }
        xyzi[o] = x; xyzi[o + 1] = y; xyzi[o + 2] = z; xyzi[o + 3] = c;
        o += 4;
      }
    }
  }
  const size = Buffer.alloc(12);
  size.writeInt32LE(m.sx, 0);
  size.writeInt32LE(m.sy, 4);
  size.writeInt32LE(m.sz, 8);
  const rgba = Buffer.alloc(1024);
  for (let k = 0; k < 255; k++) {
    const c = m.pal[k + 1] ?? [0, 0, 0, 255];
    rgba[4 * k] = c[0]; rgba[(4 * k) + 1] = c[1]; rgba[(4 * k) + 2] = c[2]; rgba[(4 * k) + 3] = c[3];
  }
  const head = Buffer.alloc(8);
  head.write("VOX ", 0, "ascii");
  head.writeInt32LE(150, 4);
  writeFileSync(path, Buffer.concat([head,
    chunk("MAIN", Buffer.alloc(0), Buffer.concat([chunk("SIZE", size), chunk("XYZI", xyzi), chunk("RGBA", rgba)]))]));
}
