// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Brick grey rock (D11.14). The stonework comes from SpiderDave's CC0
// Techno Bricks sheet (assets/third_party/spiderdave): 1536 units of
// 16 x 32 pixels, each a 16 x 16 cap tile above a 16 x 16 body tile
// that repeats. The grey units use three colours, read as three
// classes: joint (dark), stone face, lit edge. The game recolours the
// classes with its own grey rock palette.
//

import type { Texture } from "../vox/png.ts";

export const BRICK_SOURCE = "assets/third_party/spiderdave/TechnoBricks.png";

// Units used, by (row, column) of 16 x 32 units: grey stone blocks of
// mixed sizes, picked from the 50 units that use exactly the three grey
// colours (no rivets, stripes or planks). The first is the texture for
// the flat tiles; relief uses all of them.
//
export const BRICK_UNITS: [number, number][] = [[2, 15], [1, 24], [3, 58], [7, 47], [7, 55], [9, 38], [20, 63], [23, 23]];
export const BRICK_UNIT = BRICK_UNITS[0];

// Sheet colours by class: joint, stone face, lit edge.
//
export const BRICK_CLASSES: [number, number, number][] = [[34, 32, 52], [105, 106, 106], [203, 219, 252]];

// Grey rock colours for the classes (joint, stone face, lit edge) and
// for cracks from mining: soft contrast, a faint warm cast.
//
export const BRICK_PALETTE = ["#605e5c", "#999794", "#b7b4ae"];
export const BRICK_CRACK   = "#2c2a28";

// Texels (and relief voxels) per sheet pixel: 1 puts the 16 x 16 tile
// 2 x 2 times on a 32 x 32 top.
//
export const BRICK_PX = 1;

// Relief depth in voxels by class: joint, stone face, lit edge, crack
// (tools/brickvox.ts defaults). Every class is at least 1 deep, so the
// relief covers the box face beneath completely.
//
export const BRICK_HEIGHTS = [1, 3, 3, 1];

// Relief variants (cyclic shifts) per unit and stage.
//
export const BRICK_RELIEF_VARIANTS = 4;

// Class 3 is a crack.
//
export const BRICK_CRACK_CLASS = 3;

// Small deterministic random source.
//
function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    s ^= s >>> 12;
    return ( s >>> 0 ) / 4294967296;
  };
}

// A grey rock top as a 32 x 32 class map at texel (and voxel)
// resolution, x east, y south. Variants shift the tile cyclically
// (variant 0 is unshifted); mining stage s adds 2s cracks, bent lines
// two pixels thick, so each hit shows; a stage keeps the cracks of the
// stages before it.
//
export function brickClasses(tile: string, stage: number, v: number): Uint8Array {
  const n = 32 / BRICK_PX, r = rng(900 + v),
        dx = ( (v === 0) ? 0 : Math.floor(r() * 16) ), dy = ( (v === 0) ? 0 : Math.floor(r() * 16) ),
        px = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) { px[(y * n) + x] = Number(tile[(((y + dy) % 16) * 16) + ((x + dx) % 16)]); }
  }
  const cr = rng(950 + v);
  for (let k = 0; k < (2 * stage); k++) {
    let x = 2 + Math.floor(cr() * (n - 4)), y = 2 + Math.floor(cr() * (n - 4));
    let sx = ( (cr() < 0.5) ? 1 : -1 ), sy = ( (cr() < 0.5) ? 1 : -1 );
    const len = Math.round((n / 16) * (6 + (2 * k)));
    for (let s = 0; s < len; s++) {
      px[(y * n) + x] = BRICK_CRACK_CLASS;
      px[((y + 1) * n) + x] = BRICK_CRACK_CLASS;
      if ( (s % 3) === 2 ) { y += sy; }
      else                 { x += sx; }
      if (cr() < 0.12) { sy = -sy; }
      if ( (x < 1) || (y < 1) || (x >= (n - 1)) || (y >= (n - 2)) ) { break; }
    }
  }
  if (BRICK_PX === 1) { return px; }
  const out = new Uint8Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) { out[(y * 32) + x] = px[(Math.floor(y / BRICK_PX) * n) + Math.floor(x / BRICK_PX)]; }
  }
  return out;
}

// A grey rock side as a 32 x 16 class map, row 0 at the top: the upper
// or lower half of the top's map, by variant.
//
export function brickSideClasses(tile: string, stage: number, v: number): Uint8Array {
  const k = brickClasses(tile, stage, v), y0 = ( (v % 2) ? 16 : 0 );
  return k.slice(y0 * 32, (y0 + 16) * 32);
}

// The unit's body tile as 256 class digits, row by row.
//
export function brickTile(t: Texture, unit: [number, number] = BRICK_UNIT): string {
  const [r, c] = unit;
  let s = "";
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = 4 * ((((32 * r) + 16 + y) * t.w) + (16 * c) + x),
            k = BRICK_CLASSES.findIndex(q => ( (q[0] === t.p[i]) && (q[1] === t.p[i + 1]) && (q[2] === t.p[i + 2]) ));
      if (k < 0) { throw new Error("brick unit " + r + "," + c + ": unexpected colour at " + x + "," + y); }
      s += String(k);
    }
  }
  return s;
}

// ---- carved grey rock blocks (D11.14) ----

export interface CarveOpts {
  heights : number[];
  border  : number;
  chip    : number;
}

export const BRICK_CARVE: CarveOpts = { heights: BRICK_HEIGHTS, border: 0, chip: 0.35 };

// Block size in voxels: one cell across, one level (half a cell) tall.
//
export const BLOCK_XY = 32, BLOCK_Z = 16;

// Directions as in src/level/cells.ts: north, east, south, west (x east,
// y south).
//
const FACE: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// A grey rock cell as one carved block, 32 x 32 x 16 voxels (x east,
// y south, z up), each voxel 0 (empty) or 1 + its class. The top and
// every exposed side (bit d of `exposed` for direction d) carve into a
// solid block: a column of class k on a face stays solid to depth
// D - heights[k] below that face, D being the deepest height, so joints
// and cracks are cut in and stones stand at the face. Edges and corners
// are cut by every face they belong to. On exposed edges, short runs of
// the outermost voxels are chipped away (`chip`: the share of runs), so
// edges are worn but cells keep their shape. Unexposed sides stay flat
// and solid. A `border` ring of joint around the top, and at both ends
// of each side, sets cells apart (none by default).
//
export function brickBlock(tile: string, stage: number, v: number, exposed: number, o: CarveOpts = BRICK_CARVE): Uint8Array {
  const D = Math.max(1, ...o.heights), X = BLOCK_XY, Z = BLOCK_Z, b = o.border,
        top = brickClasses(tile, stage, v),
        side = [0, 1, 2, 3].map(d => brickSideClasses(tile, stage, 8 + (4 * v) + d)),
        r = rng(700 + (16 * v) + exposed), runs = new Map<string, boolean>(),
        chipped = (key: string, t: number) => {
          const k = key + ":" + Math.floor(t / 3);
          if (!runs.has(k)) { runs.set(k, ( r() < o.chip )); }
          return runs.get(k)!;
        },
        out = new Uint8Array(X * X * Z);
  for (let z = 0; z < Z; z++) {
    for (let y = 0; y < X; y++) {
      for (let x = 0; x < X; x++) {

        // Depth below the top, its class, and the nearest face so far.
        //
        const dt = (Z - 1) - z, ring = ( (x < b) || (y < b) || (x >= (X - b)) || (y >= (X - b)) ),
              kt = ( ring ? 0 : top[(y * X) + x] );
        let solid = (dt >= (D - o.heights[kt])), near = dt, cls = kt;
        const outer = [] as number[];
        for (let d = 0; d < 4; d++) {
          if (!(exposed & (1 << d))) { continue; }
          const [dx, dy] = FACE[d],
                df = ( (dx === 1) ? ((X - 1) - x) : ( (dx === -1) ? x : ( (dy === 1) ? ((X - 1) - y) : y ) ) ),
                a  = ( (d === 0) ? ((X - 1) - x) : ( (d === 1) ? ((X - 1) - y) : ( (d === 2) ? x : y ) ) ),
                ks = ( ( (a < b) || (a >= (X - b)) ) ? 0 : side[d][(dt * X) + a] );
          if (df < (D - o.heights[ks])) { solid = false; }
          if (df < near) { near = df; cls = ks; }
          if (df === 0) { outer.push(d); }
        }

        // Worn edges: the outermost voxels of an exposed edge (top and
        // side, or two sides) go in runs.
        //
        if ( solid && outer.length ) {
          for (const d of outer) {
            const a = ( ((d % 2) === 0) ? x : y );
            if ( (dt === 0) && chipped("t" + d, a) ) { solid = false; }
          }
          if ( (outer.length >= 2) && chipped("v" + outer.join(""), z) ) { solid = false; }
        }
        if (solid) { out[x + (X * (y + (X * z)))] = 1 + cls; }
      }
    }
  }
  return out;
}
