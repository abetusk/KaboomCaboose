// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Minimal PNG decoding, enough to sample a mesh's colour texture for the
// preview renderer. Handles 8-bit RGB and RGBA, non-interlaced.
//

import { inflateSync } from "node:zlib";

export interface Texture {
  w : number;
  h : number;
  p : Uint8Array;
}

export function decodePng(d: Buffer): Texture {
  if (d.readUInt32BE(0) !== 0x89504e47) { throw new Error("not a PNG"); }
  let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [] as Buffer[];
  let plte: Buffer | null = null;
  for (let i = 8; i < d.length; ) {
    const n    = d.readUInt32BE(i),
          type = d.toString("ascii", i + 4, i + 8),
          b    = i + 8;
    if (type === "IHDR") {
      w = d.readUInt32BE(b); h = d.readUInt32BE(b + 4);
      depth = d[b + 8]; ctype = d[b + 9]; interlace = d[b + 12];
    }
    else if (type === "IDAT") { idat.push(d.subarray(b, b + n)); }
    else if (type === "PLTE") { plte = d.subarray(b, b + n); }
    else if (type === "IEND") { break; }
    i = b + n + 4;
  }
  if ( (depth !== 8) || ( (ctype !== 2) && (ctype !== 3) && (ctype !== 6) ) || (interlace !== 0) || ( (ctype === 3) && !plte ) ) {
    throw new Error("unsupported PNG (depth " + depth + ", colour type " + ctype + ", interlace " + interlace + ")");
  }
  const bpp = ( (ctype === 6) ? 4 : ( (ctype === 3) ? 1 : 3 ) ),
        raw = inflateSync(Buffer.concat(idat)),
        row = w * bpp,
        out = new Uint8Array(w * h * bpp);

  // Undo the per-row filters (none, sub, up, average, Paeth).
  //
  for (let y = 0; y < h; y++) {
    const f = raw[y * (row + 1)], src = (y * (row + 1)) + 1, dst = y * row;
    for (let x = 0; x < row; x++) {
      const a = ( (x >= bpp) ? out[(dst + x) - bpp] : 0 ),
            b = ( (y > 0) ? out[(dst + x) - row] : 0 ),
            c = ( ( (x >= bpp) && (y > 0) ) ? out[((dst + x) - row) - bpp] : 0 );
      let v = raw[src + x];
      if      (f === 1) { v += a; }
      else if (f === 2) { v += b; }
      else if (f === 3) { v += Math.floor((a + b) / 2); }
      else if (f === 4) {
        const p  = (a + b) - c,
              pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += ( ( (pa <= pb) && (pa <= pc) ) ? a : ( (pb <= pc) ? b : c ) );
      }
      out[dst + x] = v & 255;
    }
  }

  // Always return RGBA; colour-mapped images look up their palette.
  //
  if (bpp === 4) { return { w, h, p: out }; }
  if (bpp === 1) {
    const p = new Uint8Array(w * h * 4);
    for (let i = 0; i < (w * h); i++) {
      const k = 3 * out[i];
      p[4 * i] = plte![k]; p[(4 * i) + 1] = plte![k + 1]; p[(4 * i) + 2] = plte![k + 2]; p[(4 * i) + 3] = 255;
    }
    return { w, h, p };
  }
  const p = new Uint8Array(w * h * 4);
  for (let i = 0; i < (w * h); i++) {
    p[4 * i] = out[3 * i]; p[(4 * i) + 1] = out[(3 * i) + 1]; p[(4 * i) + 2] = out[(3 * i) + 2]; p[(4 * i) + 3] = 255;
  }
  return { w, h, p };
}

// Colour at texture coordinates (u, v), glTF convention (v = 0 at the top).
//
export function sample(t: Texture, u: number, v: number): [number, number, number] {
  const x = Math.min(t.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * t.w))),
        y = Math.min(t.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * t.h))),
        i = 4 * ((y * t.w) + x);
  return [t.p[i], t.p[i + 1], t.p[i + 2]];
}
