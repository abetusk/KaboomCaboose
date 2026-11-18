// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Designed tile faces (D11.12): pixel-art tops and sides drawn to a plan
// rather than from noise. Each material has a small palette with lit and
// shadowed edges, eight variants (mostly plain; the last one a rare
// special), and tops come in 16
// edge versions: a lit rim along each side where the ground drops away,
// so ledges read and cells stay distinct.
//
// One sheet holds every face. Tops are 32 x 32 pixels, sides 32 x 16
// (one block's height). Pixel (px, py) of a top is cell point
// (px / 32, py / 32), y toward the south; a side's row 0 is its bottom.
//

import { CARVED_PALETTE, CARVED_TOPS, CARVED_SIDES } from "../assets/carved.ts";
import { BRICK_PALETTE, BRICK_CRACK, brickClasses } from "../assets/bricks.ts";

export const TILE = 32, SIDE = 16, VARIANTS = 8;

export const MATS = ["ground", "forest", "black", "rock0", "rock1", "rock2", "rock3"] as const;
export type Mat = (typeof MATS)[number];

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const P = {
  dirt      : hex("#b06a3e"), dirtLit  : hex("#cc8652"), dirtDark : hex("#8e5232"), dirtDeep : hex("#6e3d24"),
  pebble    : hex("#8f8f8a"), pebLit   : hex("#c2c0b6"), pebDark  : hex("#5a5a58"),
  petal     : hex("#f4f1e4"), petalY   : hex("#f2c230"), sprig    : hex("#5aa833"),
  leaf      : hex("#2f9a3a"), leafLit  : hex("#5cc24c"), leafDark : hex("#1f7a2c"), leafDeep : hex("#165e22"),
  cap       : hex("#d8403a"), capDot   : hex("#f4f1e4"),
  stone     : hex("#3c3c46"), stoneLit : hex("#5a5a66"), stoneDark: hex("#2a2a32"), mortar   : hex("#18181e"),
  moss      : hex("#4c8a2e"), mossLit  : hex("#6aa83a"),
  rock      : hex("#9c9c9c"), rockLit  : hex("#c6c6c6"), rockMid  : hex("#868686"), rockDark : hex("#6a6a6a"),
  rockLine  : hex("#4a4a4a"), crack    : hex("#2e2e2e"),
};

// Small deterministic random source per tile.
//
function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    s ^= s >>> 12;
    return ( s >>> 0 ) / 4294967296;
  };
}

class Canvas {
  w   : number;
  h   : number;
  px  : RGB[];

  constructor(w: number, h: number, fill: RGB) {
    this.w  = w;
    this.h  = h;
    this.px = Array.from({ length: w * h }, () => fill);
  }

  set(x: number, y: number, c: RGB): void {
    if ( (x >= 0) && (y >= 0) && (x < this.w) && (y < this.h) ) { this.px[(y * this.w) + x] = c; }
  }

  get(x: number, y: number): RGB { return this.px[(y * this.w) + x]; }
}

// ---- motifs ----

// A pebble: a 3 x 2 or 4 x 3 rounded stone, lit on its north-west, dark
// on its south-east.
//
function pebble(cv: Canvas, x: number, y: number, big: boolean): void {
  const w = ( big ? 4 : 3 ), h = ( big ? 3 : 2 );
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const corner = ( big && ( ((dx === 0) || (dx === (w - 1))) && ((dy === 0) || (dy === (h - 1))) ) );
      if (corner) { continue; }
      const c = ( ((dy === 0) || (dx === 0)) ? P.pebLit : ( ((dy === (h - 1)) || (dx === (w - 1))) ? P.pebDark : P.pebble ) );
      cv.set(x + dx, y + dy, c);
    }
  }
  for (let dx = ( big ? 1 : 0 ); dx < ( big ? (w - 1) : w ); dx++) { cv.set(x + dx, y + h, P.dirtDeep); }
}

// Specks: a few one- or two-pixel marks, kept apart.
//
function specks(cv: Canvas, r: () => number, n: number, c: RGB, two: boolean): void {
  const got = [] as [number, number][];
  for (let k = 0; (k < 40) && (got.length < n); k++) {
    const x = 2 + Math.floor(r() * (cv.w - 5)), y = 2 + Math.floor(r() * (cv.h - 4));
    if (got.some(([u, v]) => ( (Math.abs(u - x) + Math.abs(v - y)) < 7 ))) { continue; }
    got.push([x, y]);
    cv.set(x, y, c);
    if (two) { cv.set(x + 1, y, c); }
  }
}

// A crack: a short bent line, with a darker pixel where it bends.
//
function crackLine(cv: Canvas, r: () => number, c: RGB, len: number): void {
  let x = 4 + Math.floor(r() * (cv.w - 8)), y = 3 + Math.floor(r() * (cv.h - 6));
  let dx = ( (r() < 0.5) ? 1 : -1 ), dy = ( (r() < 0.5) ? 1 : -1 );
  for (let s = 0; s < len; s++) {
    cv.set(x, y, c);
    if ( (s % 3) === 2 ) { y += dy; } else { x += dx; }
    if (r() < 0.12) { dy = -dy; }
    if ( (x < 1) || (y < 1) || (x >= (cv.w - 1)) || (y >= (cv.h - 1)) ) { break; }
  }
}

function flower(cv: Canvas, x: number, y: number): void {
  for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) { cv.set(x + dx, y + dy, P.petal); }
  cv.set(x, y, P.petalY);
  cv.set(x, y + 2, P.sprig);
  cv.set(x + 1, y + 3, P.sprig);
}

function sprigs(cv: Canvas, r: () => number, n: number): void {
  for (let k = 0; k < n; k++) {
    const x = 3 + Math.floor(r() * (cv.w - 6)), y = 3 + Math.floor(r() * (cv.h - 6));
    cv.set(x, y, P.sprig); cv.set(x - 1, y + 1, P.sprig); cv.set(x + 1, y + 1, P.sprig);
  }
}

// ---- tops ----

function groundTop(v: number): Canvas {
  const cv = new Canvas(TILE, TILE, P.dirt), r = rng(100 + v), at = () => 5 + Math.floor(r() * 20);
  specks(cv, r, 5, P.dirtDark, true);
  specks(cv, r, 2, P.dirtLit, false);
  if ( (v === 2) || (v === 3) ) { pebble(cv, at(), at(), (v === 3)); }
  if (v === 4) { pebble(cv, at(), at(), true); pebble(cv, at(), at(), false); }
  if (v === 5) { crackLine(cv, r, P.dirtDeep, 8); }
  if (v === 6) { sprigs(cv, r, 3); }
  if (v === 7) { flower(cv, 9 + Math.floor(r() * 12), 9 + Math.floor(r() * 12)); sprigs(cv, r, 1); }
  return cv;
}

// Foliage: a staggered pattern of leaf marks, each a dark pair under a
// lit pixel, so the green reads as many small leaves.
//
function forestTop(v: number): Canvas {
  const cv = new Canvas(TILE, TILE, P.leaf), r = rng(200 + v), ox = Math.floor(r() * 8);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 4; col++) {
      const x = ((col * 8) + ox + ( ((row % 2) === 1) ? 4 : 0 ) + Math.floor(r() * 2)) % TILE, y = (row * 4) + 1 + Math.floor(r() * 2);
      cv.set(x, y, P.leafLit);
      cv.set(x, y + 1, P.leafDark); cv.set((x + 1) % TILE, y + 1, P.leafDark);
    }
  }
  if (v === 7) {
    const x = 10 + Math.floor(r() * 10), y = 10 + Math.floor(r() * 10);
    for (let dx = -1; dx <= 1; dx++) { cv.set(x + dx, y, P.cap); cv.set(x + dx, y - 1, ( (dx === 0) ? P.capDot : P.cap )); }
    cv.set(x, y + 1, P.capDot);
  }
  if (v === 6) { flower(cv, 8 + Math.floor(r() * 14), 8 + Math.floor(r() * 14)); }
  return cv;
}

// Rough stone: a few large flat facets in four tones (as if each faced
// the light differently), outlined in dark grey; each mining stage adds
// cracks.
//
function facets(cv: Canvas, r: () => number, n: number, tones: RGB[], line: RGB = P.rockLine): void {
  const seeds = Array.from({ length: n }, () => [r() * cv.w, r() * cv.h, Math.floor(r() * tones.length)]);
  const own = (x: number, y: number) => {
    let best = 0, bd = Infinity;
    seeds.forEach(([sx, sy], k) => { const d = ((x - sx) ** 2) + (((y - sy) * 1.3) ** 2); if (d < bd) { bd = d; best = k; } });
    return best;
  };
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      const k = own(x, y), edge = ( ((x + 1) < cv.w) && (own(x + 1, y) !== k) ) || ( ((y + 1) < cv.h) && (own(x, y + 1) !== k) );
      cv.set(x, y, ( edge ? line : tones[seeds[k][2]] ));
    }
  }
}

// Black rock tops: the same faceted stone in dark tones with larger
// facets; the special variant has a patch of moss.
//
function blackTop(v: number): Canvas {
  const cv = new Canvas(TILE, TILE, P.stone), r = rng(300 + v);
  facets(cv, r, 4, [P.stoneLit, P.stone, P.stone, P.stoneDark], P.mortar);
  if (v === 5) { crackLine(cv, r, P.mortar, 7); }
  if (v === 7) {
    const x = 8 + Math.floor(r() * 14), y = 8 + Math.floor(r() * 14);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [2, 0], [2, 1], [-1, 1]]) { cv.set(x + dx, y + dy, ( (((dx + dy) % 2) !== 0) ? P.moss : P.mossLit )); }
  }
  return cv;
}

function rockTop(stage: number, v: number): Canvas {
  const cv = new Canvas(TILE, TILE, P.rock), r = rng(400 + v);
  facets(cv, r, 5, [P.rockLit, P.rock, P.rock, P.rockMid]);
  const rc = rng(450 + (v * 7) + stage);
  for (let k = 0; k < stage; k++) { crackLine(cv, rc, P.crack, 5 + (2 * stage)); }
  return cv;
}

// A lit rim along each top edge in `mask` (bits N, E, S, W): the edge
// pixel lit, the one inside it a shade lighter than the face.
//
const RIM: Record<Mat, [RGB, RGB]> = {
  ground: [P.dirtLit, P.dirtLit], forest: [P.leafLit, P.leafLit], black: [P.stoneLit, P.stoneLit],
  rock0: [P.rockLit, P.rockLit], rock1: [P.rockLit, P.rockLit], rock2: [P.rockLit, P.rockLit], rock3: [P.rockLit, P.rockLit],
};

function rim(cv: Canvas, mask: number, mat: Mat): void {
  const [c] = RIM[mat];
  for (let k = 0; k < TILE; k++) {
    if (mask & 1) { cv.set(k, 0, c); }
    if (mask & 2) { cv.set(TILE - 1, k, c); }
    if (mask & 4) { cv.set(k, TILE - 1, c); }
    if (mask & 8) { cv.set(0, k, c); }
  }
}

function top(mat: Mat, v: number): Canvas {
  if (mat === "ground") { return groundTop(v); }
  if (mat === "forest") { return forestTop(v); }
  if (mat === "black")  { return blackTop(v); }
  return rockTop(Number(mat.slice(4)), v);
}

// ---- sides ----

// Dirt sides: a 1-pixel lit rim at the top of the top block, a broken
// strata line, and an embedded stone in some variants. Lower blocks are
// a shade darker and plainer.
//
function dirtSide(v: number, upper: boolean): Canvas {
  const cv = new Canvas(TILE, SIDE, ( upper ? P.dirt : P.dirtDark )), r = rng(500 + v + ( upper ? 0 : 50 ));
  const line = 5 + Math.floor(r() * 4);
  for (let x = 0; x < TILE; x++) {
    if (r() < 0.75) { cv.set(x, line, ( upper ? P.dirtDark : P.dirtDeep )); }
  }
  specks(cv, r, 3, ( upper ? P.dirtDark : P.dirtDeep ), true);
  if ( upper && ((v === 2) || (v === 4)) ) {
    const x = 4 + Math.floor(r() * 22), y = 8 + Math.floor(r() * 3);
    for (let dx = 0; dx < 4; dx++) { cv.set(x + dx, y + 1, P.pebLit); cv.set(x + dx, y, P.pebble); }
    cv.set(x + 3, y, P.pebDark);
  }
  if (upper) { for (let x = 0; x < TILE; x++) { cv.set(x, SIDE - 1, P.dirtLit); } }
  return cv;
}

// Forest sides: the top block's side carries a grass lip hanging 3 to 7
// pixels in a saw-tooth fringe, dark at its lower edge, over dirt.
//
function forestSide(v: number): Canvas {
  const cv = dirtSide(v, true), r = rng(600 + v), phase = Math.floor(r() * 6);
  for (let x = 0; x < TILE; x++) {
    const tooth = (x + phase) % 6, len = 3 + ( (tooth < 3) ? tooth : (5 - tooth) ) + ( (r() < 0.2) ? 1 : 0 );
    for (let k = 0; k < len; k++) {
      const y = SIDE - 1 - k;
      cv.set(x, y, ( (k === 0) ? P.leafLit : ( (k === (len - 1)) ? P.leafDeep : P.leaf ) ));
    }
  }
  return cv;
}

// Black rock sides: layered stone. Two ledges per block, each lit along
// its top row and dark along its bottom, broken into slabs of uneven
// length by dark joints.
//
function blackSide(v: number): Canvas {
  const cv = new Canvas(TILE, SIDE, P.stone), r = rng(700 + v);
  for (const y0 of [0, 8]) {
    let x = Math.floor(r() * 6);
    const joints = new Set<number>();
    while (x < TILE) { joints.add(x); x += 7 + Math.floor(r() * 10); }
    for (let y = y0; y < (y0 + 8); y++) {
      for (let xx = 0; xx < TILE; xx++) {
        const c = ( (y === y0) ? P.mortar : ( joints.has(xx) ? P.stoneDark : ( (y === (y0 + 7)) ? P.stoneLit : P.stone ) ) );
        cv.set(xx, y, c);
      }
    }
  }
  specks(cv, r, 2, P.stoneDark, true);
  if (v === 5) { crackLine(cv, r, P.mortar, 5); }
  return cv;
}

function rockSide(stage: number, v: number): Canvas {
  const cv = new Canvas(TILE, SIDE, P.rockMid), r = rng(800 + v);
  facets(cv, r, 4, [P.rock, P.rockMid, P.rockMid, P.rockDark]);
  for (let x = 0; x < TILE; x++) { cv.set(x, SIDE - 1, P.rockLit); }
  const rc = rng(850 + (v * 7) + stage);
  for (let k = 0; k < stage; k++) { crackLine(cv, rc, P.crack, 5 + stage); }
  return cv;
}

function side(mat: Mat, v: number, upper: boolean): Canvas {
  if (mat === "ground") { return dirtSide(v, upper); }
  if (mat === "forest") { return ( upper ? forestSide(v) : dirtSide(v, false) ); }
  if (mat === "black")  { return blackSide(v); }
  return rockSide(Number(mat.slice(4)), v);
}

// ---- carved black rock (D11.13) ----

// Class maps of etqws3's blocks (assets/generated/carved-blocks.json),
// recoloured and drawn at 2x. Tops are whole blocks; sides are a block's
// upper or lower half. The blocks carry their own lit and dark edges, so
// they get no rim.
//
function carvedPx(cv: Canvas, block: string, bx0: number, by0: number, w: number, h: number, flipV: boolean): void {
  const pal = CARVED_PALETTE.map(hex);
  for (let by = 0; by < h; by++) {
    for (let bx = 0; bx < w; bx++) {
      const c = pal[Number(block[((by0 + by) * 16) + bx0 + bx])];
      for (let k = 0; k < 4; k++) {
        const x = (2 * bx) + (k % 2), y = (2 * by) + (k >> 1);
        cv.set(x, ( flipV ? ((cv.h - 1) - y) : y ), c);
      }
    }
  }
}

function carvedTop(blocks: string[], v: number): Canvas {
  const cv = new Canvas(TILE, TILE, P.stone), [r, c] = CARVED_TOPS[v];
  carvedPx(cv, blocks[(4 * r) + c], 0, 0, 16, 16, false);
  return cv;
}

function carvedSide(blocks: string[], v: number): Canvas {
  const cv = new Canvas(TILE, SIDE, P.stone), [r, c] = CARVED_SIDES[v % 2];
  carvedPx(cv, blocks[(4 * r) + c], 0, ( ((v >> 1) % 2) ? 8 : 0 ), 16, 8, true);
  return cv;
}

// ---- brick grey rock (D11.14) ----

// The Techno Bricks body tile (assets/generated/rock-bricks.json) as a
// class map (src/assets/bricks.ts), recoloured. Tops are the whole map;
// sides are its upper or lower half. The tile carries its own lit and
// dark edges, so tops get no rim.
//
function brickColour(): RGB[] { return [...BRICK_PALETTE, BRICK_CRACK].map(hex); }

function brickTop(tile: string, stage: number, v: number): Canvas {
  const cv = new Canvas(TILE, TILE, P.rock), k = brickClasses(tile, stage, v), pal = brickColour();
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) { cv.set(x, y, pal[k[(y * TILE) + x]]); }
  }
  return cv;
}

function brickSide(tile: string, stage: number, v: number): Canvas {
  const cv = new Canvas(TILE, SIDE, P.rock), k = brickClasses(tile, stage, v), pal = brickColour(),
        y0 = ( (v % 2) ? SIDE : 0 );
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < TILE; x++) { cv.set(x, (SIDE - 1) - y, pal[k[((y0 + y) * TILE) + x]]); }
  }
  return cv;
}

// ---- the sheet ----

export interface TileSheet {
  w    : number;
  h    : number;
  data : Uint8Array;
  top  : (mat: Mat, v: number, mask: number) => [number, number, number, number];
  side : (mat: Mat, v: number, upper: boolean) => [number, number, number, number];
}

const COLS = 32;

export function tileSheet(carved: string[] | null = null, brick: string | null = null): TileSheet {
  const nTop = MATS.length * VARIANTS * 16, nSide = MATS.length * VARIANTS * 2,
        topRows = Math.ceil(nTop / COLS), sideRows = Math.ceil(nSide / COLS),
        w = COLS * TILE, h = (topRows * TILE) + (sideRows * SIDE), data = new Uint8Array(w * h * 4);
  const blit = (cv: Canvas, ox: number, oy: number) => {
    for (let y = 0; y < cv.h; y++) {
      for (let x = 0; x < cv.w; x++) {
        const c = cv.get(x, y), i = 4 * (((oy + y) * w) + ox + x);
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
      }
    }
  };
  MATS.forEach((mat, mi) => {
    for (let v = 0; v < VARIANTS; v++) {
      const cut   = ( carved && (mat === "black") ),
            brk   = ( brick && mat.startsWith("rock") ),
            stage = ( brk ? Number(mat.slice(4)) : 0 ),
            base  = ( cut ? carvedTop(carved!, v) : ( brk ? brickTop(brick!, stage, v) : top(mat, v) ) );
      for (let mask = 0; mask < 16; mask++) {
        const cv = new Canvas(TILE, TILE, P.dirt);
        cv.px = base.px.slice();
        if ( !cut && !brk ) { rim(cv, mask, mat); }
        const t = (((mi * VARIANTS) + v) * 16) + mask;
        blit(cv, (t % COLS) * TILE, Math.floor(t / COLS) * TILE);
      }
      for (const upper of [false, true]) {
        const s = (((mi * VARIANTS) + v) * 2) + ( upper ? 1 : 0 );
        const sv = ( cut ? carvedSide(carved!, v) : ( brk ? brickSide(brick!, stage, v) : side(mat, v, upper) ) );
        blit(sv, (s % COLS) * TILE, (topRows * TILE) + (Math.floor(s / COLS) * SIDE));
      }
    }
  });

  // A small inset keeps nearest sampling off the neighbouring tile.
  //
  const e = 0.02;
  const uv = (x: number, y: number, tw: number, th: number): [number, number, number, number] =>
    [(x + e) / w, (y + e) / h, (x + tw - e) / w, (y + th - e) / h];
  return {
    w, h, data,
    top: (mat, v, mask) => {
      const t = (((MATS.indexOf(mat) * VARIANTS) + v) * 16) + mask;
      return uv((t % COLS) * TILE, Math.floor(t / COLS) * TILE, TILE, TILE);
    },
    side: (mat, v, upper) => {
      const s = (((MATS.indexOf(mat) * VARIANTS) + v) * 2) + ( upper ? 1 : 0 );
      return uv((s % COLS) * TILE, (topRows * TILE) + (Math.floor(s / COLS) * SIDE), TILE, SIDE);
    },
  };
}
