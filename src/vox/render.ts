// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Isometric preview images of voxel models, written as PNG. For reviewing
// assets only; the game renders with three.js.
//

import { deflateSync, crc32 } from "node:zlib";
import { VoxModel } from "./vox.ts";

export class Image {
  w : number;
  h : number;
  p : Uint8Array;

  constructor(w: number, h: number, bg: [number, number, number] = [236, 232, 224]) {
    this.w = w;
    this.h = h;
    this.p = new Uint8Array(w * h * 4);
    for (let i = 0; i < (w * h); i++) {
      this.p[4 * i] = bg[0]; this.p[(4 * i) + 1] = bg[1]; this.p[(4 * i) + 2] = bg[2]; this.p[(4 * i) + 3] = 255;
    }
  }

  put(x: number, y: number, c: [number, number, number]): void {
    if ( (x < 0) || (y < 0) || (x >= this.w) || (y >= this.h) ) { return; }
    const i = 4 * ((y * this.w) + x);
    this.p[i] = c[0]; this.p[i + 1] = c[1]; this.p[i + 2] = c[2];
  }

  blit(src: Image, ox: number, oy: number): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const i = 4 * ((y * src.w) + x);
        this.put(ox + x, oy + y, [src.p[i], src.p[i + 1], src.p[i + 2]]);
      }
    }
  }

  png(): Buffer {
    const raw = Buffer.alloc(this.h * ((this.w * 4) + 1));
    for (let y = 0; y < this.h; y++) {
      raw[y * ((this.w * 4) + 1)] = 0;
      Buffer.from(this.p.buffer, y * this.w * 4, this.w * 4).copy(raw, (y * ((this.w * 4) + 1)) + 1);
    }
    const chunk = (type: string, body: Buffer) => {
      const len = Buffer.alloc(4), crc = Buffer.alloc(4), tb = Buffer.from(type, "ascii");
      len.writeUInt32BE(body.length);
      crc.writeUInt32BE(crc32(Buffer.concat([tb, body])));
      return Buffer.concat([len, tb, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

// A model placed in a scene at an offset (in voxels).
//
export interface Placed {
  m  : VoxModel;
  ox : number;
  oy : number;
  oz : number;
}

// A flat-coloured triangle in voxel units (used to show meshes, such as
// the Kenney characters, beside voxel models).
//
export interface Tri {
  p : [number, number, number][];
  c : [number, number, number];
}

// Render placed models and triangles isometrically with `s` pixels per
// voxel edge. Visible voxel faces: top (+z), +x and +y, shaded
// 1.0 / 0.82 / 0.66; triangles are shaded by blending those three by
// their normal. Uses a depth buffer, so overlapping models draw
// correctly.
//
export function renderScene(items: Placed[], s: number, tris: Tri[] = []): Image {
  type V = { x: number, y: number, z: number, c: [number, number, number] };
  const occ = new Set<string>(), vs = [] as V[];
  for (const it of items) {
    for (let z = 0; z < it.m.sz; z++) {
      for (let y = 0; y < it.m.sy; y++) {
        for (let x = 0; x < it.m.sx; x++) {
          const c = it.m.get(x, y, z);
          if (!c) { continue; }
          const X = x + it.ox, Y = y + it.oy, Z = z + it.oz, pc = it.m.pal[c];
          occ.add(X + "," + Y + "," + Z);
          vs.push({ x: X, y: Y, z: Z, c: [pc[0], pc[1], pc[2]] });
        }
      }
    }
  }
  const has = (x: number, y: number, z: number) => occ.has(x + "," + y + "," + z);
  const px = (x: number, y: number)            => ((x - y) * 0.866 * s),
        py = (x: number, y: number, z: number) => ((((x + y) * 0.5) - z) * s);

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of vs) {
    for (const [dx, dy, dz] of [[0,1,0],[1,0,0],[0,0,1],[1,1,0]]) {
      const a = px(v.x + dx, v.y + dy), b = py(v.x + dx, v.y + dy, v.z + dz);
      x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
    }
  }
  for (const t of tris) {
    for (const [x, y, z] of t.p) {
      const a = px(x, y), b = py(x, y, z);
      x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
    }
  }
  const pad = 4,
        img = new Image(Math.ceil(x1 - x0) + (2 * pad), Math.ceil(y1 - y0) + (2 * pad)),
        dep = new Float64Array(img.w * img.h).fill(-Infinity);

  // Fill a convex quad, keeping the nearest surface (largest x + y + z).
  //
  const quad = (pts: [number, number][], depth: number, c: [number, number, number]) => {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const ax = Math.floor(Math.min(...xs)), bx = Math.ceil(Math.max(...xs)),
          ay = Math.floor(Math.min(...ys)), by = Math.ceil(Math.max(...ys));
    for (let y = ay; y < by; y++) {
      for (let x = ax; x < bx; x++) {
        const cx = x + 0.5, cy = y + 0.5;
        let inside = true, sgn = 0;
        for (let k = 0; k < 4; k++) {
          const [p0x, p0y] = pts[k], [p1x, p1y] = pts[(k + 1) % 4],
                cr = ((p1x - p0x) * (cy - p0y)) - ((p1y - p0y) * (cx - p0x));
          if (cr === 0) { continue; }
          const sg = ( (cr > 0) ? 1 : -1 );
          if (sgn === 0) { sgn = sg; }
          else if (sg !== sgn) { inside = false; break; }
        }
        if (!inside) { continue; }
        const i = (y * img.w) + x;
        if ( (x < 0) || (y < 0) || (x >= img.w) || (y >= img.h) || (depth < dep[i]) ) { continue; }
        dep[i] = depth;
        img.put(x, y, c);
      }
    }
  };
  const P = (x: number, y: number, z: number): [number, number] => [px(x, y) - x0 + pad, py(x, y, z) - y0 + pad];
  const shade = (c: [number, number, number], k: number): [number, number, number] =>
    [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];

  for (const { x, y, z, c } of vs) {
    const d = x + y + z;
    if (!has(x, y, z + 1)) { quad([P(x, y, z + 1), P(x + 1, y, z + 1), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], d + 1.0, shade(c, 1.0)); }
    if (!has(x + 1, y, z)) { quad([P(x + 1, y, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x + 1, y, z + 1)], d + 0.9, shade(c, 0.82)); }
    if (!has(x, y + 1, z)) { quad([P(x, y + 1, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], d + 0.9, shade(c, 0.66)); }
  }

  // Triangles: depth is x + y + z interpolated across the triangle, the
  // same measure the voxel faces use. Meshes may be double sided, so the
  // normal is turned toward the viewer before shading.
  //
  for (const t of tris) {
    const [a, b, c] = t.p,
          e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
          e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
          n  = [(e1[1] * e2[2]) - (e1[2] * e2[1]), (e1[2] * e2[0]) - (e1[0] * e2[2]), (e1[0] * e2[1]) - (e1[1] * e2[0])],
          nl = Math.hypot(n[0], n[1], n[2]);
    if (nl === 0) { continue; }
    const k  = ( ((n[0] * n[0]) * 0.82) + ((n[1] * n[1]) * 0.66) + ((n[2] * n[2]) * 1.0) ) / (nl * nl),
          col = shade(t.c, k),
          q  = t.p.map(([x, y, z]) => P(x, y, z)),
          dz = t.p.map(([x, y, z]) => (x + y + z)),
          ar = ((q[1][0] - q[0][0]) * (q[2][1] - q[0][1])) - ((q[2][0] - q[0][0]) * (q[1][1] - q[0][1]));
    if (Math.abs(ar) < 1e-9) { continue; }
    const ax = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))),
          bx = Math.min(img.w, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))),
          ay = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))),
          by = Math.min(img.h, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])));
    for (let y = ay; y < by; y++) {
      for (let x = ax; x < bx; x++) {
        const cx = x + 0.5, cy = y + 0.5,
              w0 = (((q[1][0] - cx) * (q[2][1] - cy)) - ((q[2][0] - cx) * (q[1][1] - cy))) / ar,
              w1 = (((q[2][0] - cx) * (q[0][1] - cy)) - ((q[0][0] - cx) * (q[2][1] - cy))) / ar,
              w2 = 1 - w0 - w1;
        if ( (w0 < 0) || (w1 < 0) || (w2 < 0) ) { continue; }
        const depth = (w0 * dz[0]) + (w1 * dz[1]) + (w2 * dz[2]),
              i     = (y * img.w) + x;
        if (depth < dep[i]) { continue; }
        dep[i] = depth;
        img.put(x, y, col);
      }
    }
  }
  return img;
}
