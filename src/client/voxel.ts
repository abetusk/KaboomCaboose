// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Voxel models in the browser (D13.4): read .vox files, turn small models
// into meshes, and turn terrain blocks into textures for plain boxes.
//
// Axes: a model's x and y are the level's x and y (east, south) and z is
// up; in three.js that is X = x, Y = z, Z = y. One cell is 32 voxels, so
// models are scaled by 1/32.
//

import * as THREE from "three";

export const VOXEL = 1 / 32;

export interface Vox {
  sx  : number;
  sy  : number;
  sz  : number;
  v   : Uint8Array;
  pal : [number, number, number][];
}

export function voxGet(m: Vox, x: number, y: number, z: number): number {
  if ( (x < 0) || (y < 0) || (z < 0) || (x >= m.sx) || (y >= m.sy) || (z >= m.sz) ) { return 0; }
  return m.v[x + (m.sx * (y + (m.sy * z)))];
}

// Parse a .vox file; all models of the same size are merged (as the
// node reader does).
//
export function parseVox(buf: ArrayBuffer): Vox {
  const d = new DataView(buf), u8 = new Uint8Array(buf);
  const id = (o: number) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (id(0) !== "VOX ") { throw new Error("not a .vox file"); }
  let size: number[] | null = null;
  const parts = [] as [number, number][];
  let pal = [] as [number, number, number][];
  for (let i = 20; i < u8.length; ) {
    const n = d.getInt32(i + 4, true), m = d.getInt32(i + 8, true), b = i + 12, t = id(i);
    if      ( (t === "SIZE") && !size ) { size = [d.getInt32(b, true), d.getInt32(b + 4, true), d.getInt32(b + 8, true)]; }
    else if (t === "XYZI")              { parts.push([b, n]); }
    else if (t === "RGBA") {
      pal = [[0, 0, 0]];
      for (let k = 0; k < 255; k++) { pal.push([u8[b + (4 * k)], u8[b + (4 * k) + 1], u8[b + (4 * k) + 2]]); }
    }
    i = b + n + m;
  }
  if (!size) { throw new Error("no model in .vox"); }
  if (!pal.length) { for (let k = 0; k < 256; k++) { pal.push([k, k, k]); } }
  const [sx, sy, sz] = size, v = new Uint8Array(sx * sy * sz);
  for (const [b] of parts) {
    const n = d.getInt32(b, true);
    for (let k = 0; k < n; k++) {
      const o = b + 4 + (4 * k), x = u8[o], y = u8[o + 1], z = u8[o + 2];
      if ( (x < sx) && (y < sy) && (z < sz) ) { v[x + (sx * (y + (sy * z)))] = u8[o + 3]; }
    }
  }
  return { sx, sy, sz, v, pal };
}

export async function loadVox(url: string): Promise<Vox> {
  const r = await fetch(url);
  if (!r.ok) { throw new Error(url + ": " + r.status); }
  return parseVox(await r.arrayBuffer());
}

const linear = (c: number) => { const s = c / 255; return ( (s <= 0.04045) ? (s / 12.92) : (((s + 0.055) / 1.055) ** 2.4) ); };

// A mesh of the model's exposed faces with vertex colours, greedy
// meshed: on each slice, neighbouring exposed faces of the same colour
// merge into one rectangle, which cuts triangle counts several times
// over. `centre` moves the origin to the middle of the model's
// footprint (x, y) and its base (z = 0), which suits rotating pieces
// about a cell's centre.
//
// Four corners of a quad, (b, c) slice coordinates in order, written as
// positions (three.js axes), normals and colours.
//
function quadOut(out: { pos: number[], nor: number[], col: number[] }, q: number[], a: number, b: number, c: number, plane: number,
                 ox: number, oy: number, n3: number[], rgb: number[], ...bc: number[]): void {
  for (let k = 0; k < 8; k += 2) {
    q[a] = plane; q[b] = bc[k]; q[c] = bc[k + 1];
    out.pos.push((q[0] - ox) * VOXEL, q[2] * VOXEL, (q[1] - oy) * VOXEL);
    out.nor.push(n3[0], n3[1], n3[2]);
    out.col.push(rgb[0], rgb[1], rgb[2]);
  }
}

export function voxGeometry(m: Vox, centre = false): THREE.BufferGeometry {
  const pos = [] as number[], nor = [] as number[], col = [] as number[], idx = [] as number[];
  const lin = [] as number[][], out = { pos, nor, col };
  const ox = ( centre ? (m.sx / 2) : 0 ), oy = ( centre ? (m.sy / 2) : 0 ),
        size = [m.sx, m.sy, m.sz];

  // Model axes a (the face normal's axis), b and c (the slice's axes).
  //
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3, nb = size[b], nc = size[c];
    for (const sign of [1, -1]) {
      const mask = new Int32Array(nb * nc), n3 = [0, 0, 0], q = [0, 0, 0];
      n3[[0, 2, 1][a]] = sign;

      // Winding: corners go b then c; in three.js axes that faces along
      // the normal or against it, the same for every quad of this
      // direction, so test one unit square.
      //
      const t3 = (qq: number[]) => [qq[0], qq[2], qq[1]], u0 = [0, 0, 0], u1 = [0, 0, 0], u3 = [0, 0, 0];
      u1[b] = 1; u3[c] = 1;
      const e1 = t3(u1).map((x, k) => (x - t3(u0)[k])), e2 = t3(u3).map((x, k) => (x - t3(u0)[k])),
            cr = [(e1[1] * e2[2]) - (e1[2] * e2[1]), (e1[2] * e2[0]) - (e1[0] * e2[2]), (e1[0] * e2[1]) - (e1[1] * e2[0])],
            flip = ( ((cr[0] * n3[0]) + (cr[1] * n3[1]) + (cr[2] * n3[2])) < 0 );
      for (let sl = 0; sl < size[a]; sl++) {

        // Colours of the faces exposed on this slice, 0 where none. Index
        // arithmetic by axis stride; the neighbour across the face is
        // empty outside the model.
        //
        const st = [1, m.sx, m.sx * m.sy], sa = st[a], sb = st[b], sc = st[c],
              inside = ( ((sl + sign) >= 0) && ((sl + sign) < size[a]) ), off = sign * sa;
        for (let j = 0; j < nc; j++) {
          let q = (sl * sa) + (j * sc);
          for (let i = 0; i < nb; i++, q += sb) {
            const v = m.v[q];
            mask[i + (j * nb)] = ( (v && !( inside && m.v[q + off] )) ? v : 0 );
          }
        }

        // Greedy rectangles of one colour.
        //
        for (let j = 0; j < nc; j++) {
          for (let i = 0; i < nb; ) {
            const v = mask[i + (j * nb)];
            if (!v) { i++; continue; }
            let w = 1;
            while ( ((i + w) < nb) && (mask[i + w + (j * nb)] === v) ) { w++; }
            let h = 1;
            grow: while ((j + h) < nc) {
              for (let k = 0; k < w; k++) { if (mask[i + k + ((j + h) * nb)] !== v) { break grow; } }
              h++;
            }
            for (let jj = 0; jj < h; jj++) { for (let k = 0; k < w; k++) { mask[i + k + ((j + jj) * nb)] = 0; } }

            // Corners in model axes, then three.js axes (X = x, Y = z,
            // Z = y), wound to face along the normal.
            //
            const plane = sl + ( (sign > 0) ? 1 : 0 ), base = pos.length / 3,
                  rgb = lin[v] ?? (lin[v] = m.pal[v].map(linear));
            const i1 = i + w, j1 = j + h;
            if (flip) { quadOut(out, q, a, b, c, plane, ox, oy, n3, rgb, i, j, i, j1, i1, j1, i1, j); }
            else      { quadOut(out, q, a, b, c, plane, ox, oy, n3, rgb, i, j, i1, j, i1, j1, i, j1); }
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            i += w;
          }
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---- terrain atlas ----

// Each terrain block model becomes a 32-wide strip of the atlas: its top
// (32 x 32, the highest voxel of each column) and its four sides (32 x 16
// each, the outermost voxel of each row), in the order +X, -X, +Z, -Z.
//
export const TILE = 32, SIDE = 16, STRIP = TILE + (4 * SIDE);

export class Atlas {
  n       : number;
  data    : Uint8Array;
  texture : THREE.DataTexture;
  w       : number;

  constructor(models: Vox[]) {
    this.n    = models.length;
    this.w    = TILE * this.n;
    this.data = new Uint8Array(this.w * STRIP * 4);
    models.forEach((m, k) => this.paint(m, k));
    this.texture = new THREE.DataTexture(this.data, this.w, STRIP, THREE.RGBAFormat);
    this.texture.magFilter  = THREE.NearestFilter;
    this.texture.minFilter  = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
  }

  private put(px: number, py: number, rgb: [number, number, number]): void {
    const i = 4 * ((py * this.w) + px);
    this.data[i] = rgb[0]; this.data[i + 1] = rgb[1]; this.data[i + 2] = rgb[2]; this.data[i + 3] = 255;
  }

  private paint(m: Vox, k: number): void {
    const x0 = k * TILE, fall: [number, number, number] = [110, 84, 60];
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        let c = 0;
        for (let z = m.sz - 1; (z >= 0) && !c; z--) { c = voxGet(m, x, y, z); }
        this.put(x0 + x, y, ( c ? m.pal[c] : fall ));
      }
    }

    // Sides: column = position along the face, row = height.
    //
    const side = (f: number, a: number, z: number): number => {
      const L = ( (f < 2) ? m.sx : m.sy );
      for (let s = 0; s < L; s++) {
        const t = ( ((f % 2) === 0) ? ((L - 1) - s) : s ),
              c = ( (f < 2) ? voxGet(m, t, a, z) : voxGet(m, a, t, z) );
        if (c) { return c; }
      }
      return 0;
    };
    for (let f = 0; f < 4; f++) {
      for (let z = 0; z < SIDE; z++) {
        for (let a = 0; a < TILE; a++) {
          const c = side(f, a, Math.min(z, m.sz - 1));
          this.put(x0 + a, TILE + (f * SIDE) + z, ( c ? m.pal[c] : fall ));
        }
      }
    }
  }

  // UV rectangle of a model's top or side f (0..3).
  //
  uv(k: number, part: "top" | number): [number, number, number, number] {
    const u0 = (k * TILE) / this.w, u1 = ((k + 1) * TILE) / this.w;
    if (part === "top") { return [u0, 0, u1, TILE / STRIP]; }
    const v0 = (TILE + (part * SIDE)) / STRIP;
    return [u0, v0, u1, v0 + (SIDE / STRIP)];
  }
}

// Geometry builder for terrain boxes, one block face at a time.
//
export class BoxBuilder {
  pos : number[] = [];
  nor : number[] = [];
  uv  : number[] = [];
  col : number[] = [];
  idx : number[] = [];

  // A quad from four corners (counter-clockwise from outside) with
  // texture corners in the same order, and one colour or a colour per
  // corner. `diag` splits it along corners 1-3 instead of 0-2, which
  // keeps per-corner shading from creasing the wrong way.
  //
  quad(p: number[][], n: number[], t: [number, number][], c: number[] | number[][] = [1, 1, 1], diag = false): void {
    const base = this.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const ck = ( Array.isArray(c[0]) ? (c as number[][])[k] : (c as number[]) );
      this.pos.push(p[k][0], p[k][1], p[k][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(t[k][0], t[k][1]);
      this.col.push(ck[0], ck[1], ck[2]);
    }
    if (diag) { this.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base); }
    else      { this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}
