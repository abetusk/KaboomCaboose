// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

import { CONFIG } from "../config.ts";
import { Cell, Grid, DIRS, DIR_NONE, isRamp, type CellType } from "../level/cells.ts";
import { Rng } from "./rng.ts";
import { analyze, resourceCheck, reachable, type Analysis, type Pt, type Rules } from "./analyze.ts";

export interface GenParams {
  seed        : number;
  length      : number;
  width       : number;
  chokes      : number;
  C           : number;
  bridgeTrees : number;

  // Gap widths at choke points for the narrow route (A) and the
  // wide route (B).
  //
  narrowGap : [number, number];
  wideGap   : [number, number];

  // Choke wall thickness along x, before each row's edges are moved by up
  // to a cell at random.
  //
  wallThickness : [number, number];

  // Hint for the rows of black rock between the two gaps in each wall:
  // 0 for no preference, -1 for as far apart as the level's width
  // allows. Best effort: the nearest separation that fits is used, and
  // never fewer than MIN_SEP rows.
  //
  chokeSeparation : number;

  // Seeds per 1000 cells for each grown feature.
  //
  forestDensity    : number;
  rockDensity      : number;
  blackrockDensity : number;
  pondDensity      : number;

  // Cells per grown feature, [min, max]. Each seed grows a blob of a
  // random size in this range (smaller if it runs out of room).
  //
  forestSize    : [number, number];
  rockSize      : [number, number];
  blackrockSize : [number, number];
  pondSize      : [number, number];

  // Height. `levels` height levels (1 = flat). The surface follows
  // low-octave Perlin noise with features about `hillScale` cells across,
  // plus a weak second octave of relative strength `hillNoise` so outlines
  // are not perfectly round. No region of one level is smaller than
  // `minBlob` cells. Ramps are not generated: players build them.
  //
  // Black rock rises toward its interior: one level per `mountainStep`
  // cells in from its edge, at most `mountainMax` levels above the
  // terrain under it.
  //
  levels       : number;
  hillScale    : number;
  hillNoise    : number;
  minBlob      : number;
  mountainStep : number;
  mountainMax  : number;

  // Ramps included in the level. `rampChance`: chance per eligible cell
  // of a grey rock ramp on a level boundary (0 = none). `pathRamps`: build
  // the ramps the cheapest track needs (except ramps that would stand on
  // a bridge, since bridges are not placed).
  //
  rampChance : number;
  pathRamps  : boolean;

  // Trees and rock are not grown within this distance of route A
  // (unless also near route B), so route A is light on resources.
  //
  sparseRadius : number;

  // Accept a level only if every route's resource ratio is at least this.
  //
  minRatio    : number;
  maxAttempts : number;

  // Station length in cells along x. The whole train stands in a
  // station, so this is at least the train's length (3 cars of 2 cells).
  //
  stationLength : number;

  // Station rows. When set, the station is placed on that row; otherwise
  // the row is random. Chaining levels: pass the previous level's endY as
  // the next level's startY.
  //
  startY : number | null;
  endY   : number | null;

  // With startY set: the start station's ground height. The height map is
  // shifted (and held to 0 to levels - 1) so the start station stands at
  // this height, which chaining passes on from the previous level's end
  // station (D6.4). Not read from config/game.json.
  //
  startZ? : number | null;
}

// Defaults come from config/game.json: the "levelgen" section, plus C and
// bridgeTrees from "rules", which the game uses too. Each key is checked
// against the type of a reference value so a bad edit fails at load.
//
const SHAPE: Record<Exclude<keyof GenParams, "startZ">, string> = {
  seed: "number", length: "number", width: "number", chokes: "number", C: "number", bridgeTrees: "number",
  narrowGap: "range", wideGap: "range", wallThickness: "range", chokeSeparation: "number",
  forestDensity: "number", rockDensity: "number", blackrockDensity: "number", pondDensity: "number",
  forestSize: "range", rockSize: "range", blackrockSize: "range", pondSize: "range",
  levels: "number", hillScale: "number", hillNoise: "number", minBlob: "number",
  mountainStep: "number", mountainMax: "number",
  rampChance: "number", pathRamps: "boolean",
  sparseRadius: "number", minRatio: "number", maxAttempts: "number", stationLength: "number",
  startY: "row", endY: "row",
};

function loadDefaults(): GenParams {
  const v: Record<string, unknown> = { ...CONFIG.levelgen, C: CONFIG.rules.C, bridgeTrees: CONFIG.rules.bridgeTrees };
  for (const [k, kind] of Object.entries(SHAPE)) {
    const x  = v[k],
          ok = ( (kind === "number")  ? (typeof x === "number") :
               ( (kind === "boolean") ? (typeof x === "boolean") :
               ( (kind === "row")     ? ( (x === null) || (typeof x === "number") ) :
                 ( Array.isArray(x) && (x.length === 2) && x.every(e => (typeof e === "number")) ) ) ) );
    if (!ok) { throw new Error("config/game.json: levelgen." + k + " should be " + kind); }
  }
  for (const k of Object.keys(v)) {
    if (!(k in SHAPE)) { throw new Error("config/game.json: levelgen." + k + " is not a generator parameter"); }
  }
  return v as unknown as GenParams;
}

export const DEFAULTS: GenParams = loadDefaults();

export interface Route {
  name  : string;
  cells : Pt[];
  gaps  : number[];
}

export interface RouteStats {
  name        : string;
  track       : number;
  gaps        : number[];
  nearTrees   : number;
  nearRock    : number;
  feasible    : boolean;
  ratio       : number;
}

export interface Level {
  params   : GenParams;
  attempt  : number;
  grid     : Grid;
  routes   : Route[];
  chokesX  : number[];
  analysis : Analysis;
  routeStats : RouteStats[];
}

// Minimum rows of black rock between the two gaps in one wall.
//
const MIN_SEP = 2;

// First row of a gap of width w centred on row y.
//
function gapStart(y: number, w: number): number {
  return y - Math.floor((w - 1) / 2);
}

// Thrown when an attempt cannot be completed; generate() retries.
//
class RetryError extends Error {}

function sign(v: number): number {
  return ( (v > 0) ? 1 : ( (v < 0) ? -1 : 0 ) );
}

// Walk from a to b, never stepping back in x. Steps toward b are chosen
// with probability proportional to the remaining distance on each axis.
// With probability `jitter`, while x still has distance to cover, take a
// random y step instead, to keep paths from looking ruled.
//
function walk(rng: Rng, a: Pt, b: Pt, h: number, jitter: number, out: Pt[]): void {
  let [x, y] = a;
  const [bx, by] = b;
  while ( (x !== bx) || (y !== by) ) {
    const rx = Math.abs(bx - x), ry = Math.abs(by - y);
    if ( (rx > 0) && rng.chance(jitter) ) {
      const ny = y + (rng.chance(0.5) ? 1 : -1);
      if ( (ny >= 1) && (ny <= (h - 2)) && ( Math.abs(by - ny) < rx ) ) {
        y = ny;
        out.push([x, y]);
        continue;
      }
    }
    if ( rng.next() < (rx / (rx + ry)) ) { x += sign(bx - x); }
    else                                 { y += sign(by - y); }
    out.push([x, y]);
  }
}

// Grow a blob of cell type c from (x, y) up to `size` cells. Only cells
// for which `ok` is true are taken.
//
function grow(g: Grid, rng: Rng, x: number, y: number, size: number, c: CellType,
              ok: (x: number, y: number) => boolean): void {
  if (!ok(x, y)) { return; }
  const front: Pt[] = [[x, y]],
        taken = new Set<number>([(y * g.w) + x]);
  let n = 0;
  while ( front.length && (n < size) ) {
    const k = rng.int(0, front.length - 1),
          [px, py] = front[k];
    front[k] = front[front.length - 1];
    front.pop();
    g.set(px, py, c);
    n++;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = px + dx, ny = py + dy, i = (ny * g.w) + nx;
      if ( !g.inside(nx, ny) || taken.has(i) || !ok(nx, ny) ) { continue; }
      if (!rng.chance(0.7)) { continue; }
      taken.add(i);
      front.push([nx, ny]);
    }
  }
}

// 2D Perlin gradient noise: a random unit gradient at each lattice point
// (spacing `cell`), blended with the quintic fade. Returns values in
// about [-0.7, 0.7].
//
function perlin(rng: Rng, w: number, h: number, cell: number): Float64Array {
  const gw  = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2,
        gx  = new Float64Array(gw * gh), gy = new Float64Array(gw * gh),
        out = new Float64Array(w * h);
  for (let i = 0; i < gx.length; i++) {
    const t = rng.next() * 2 * Math.PI;
    gx[i] = Math.cos(t);
    gy[i] = Math.sin(t);
  }
  const ox   = rng.next() * cell, oy = rng.next() * cell,
        fade = (t: number) => ( t * t * t * ((t * ((t * 6) - 15)) + 10) );
  const dot  = (ix: number, iy: number, dx: number, dy: number) => {
    const k = (iy * gw) + ix;
    return ( (gx[k] * dx) + (gy[k] * dy) );
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x + ox) / cell, fy = (y + oy) / cell,
            ix = Math.floor(fx),  iy = Math.floor(fy),
            dx = fx - ix,         dy = fy - iy,
            u  = fade(dx),        v  = fade(dy);
      const n00 = dot(ix, iy, dx, dy),         n10 = dot(ix + 1, iy, dx - 1, dy),
            n01 = dot(ix, iy + 1, dx, dy - 1), n11 = dot(ix + 1, iy + 1, dx - 1, dy - 1);
      const top = n00 + ((n10 - n00) * u),
            bot = n01 + ((n11 - n01) * u);
      out[(y * w) + x] = top + ((bot - top) * v);
    }
  }
  return out;
}

// Label 4-connected regions of equal height. Returns region id per cell
// and the size of each region.
//
function regions(g: Grid): { id: Int32Array, size: number[] } {
  const id = new Int32Array(g.w * g.h).fill(-1), size = [] as number[];
  for (let s0 = 0; s0 < id.length; s0++) {
    if (id[s0] >= 0) { continue; }
    const r = size.length, st = [s0];
    id[s0] = r;
    let n = 0;
    while (st.length) {
      const k = st.pop()!, x = k % g.w, y = (k / g.w) | 0;
      n++;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!g.inside(nx, ny)) { continue; }
        const j = (ny * g.w) + nx;
        if ( (id[j] < 0) && (g.height[j] === g.height[k]) ) { id[j] = r; st.push(j); }
      }
    }
    size.push(n);
  }
  return { id, size };
}

// Surface heights in [0, levels - 1] from low-octave Perlin noise: one
// octave of features about `scale` cells across plus a weak second octave
// (`noise`) for slightly irregular outlines, stretched to the full range
// and cut into bands. Then cleaned so every level region is a large blob:
// a 3x3 majority filter removes thin slivers, and regions smaller than
// `minBlob` cells are merged into the neighbouring level they touch most.
//
function heightmap(g: Grid, rng: Rng, levels: number, scale: number, noise: number, minBlob: number): void {
  if (levels <= 1) { return; }
  const base   = perlin(rng, g.w, g.h, scale),
        detail = perlin(rng, g.w, g.h, Math.max(2, scale / 2));
  const f = new Float64Array(g.w * g.h);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < f.length; i++) {
    f[i] = base[i] + (detail[i] * noise);
    lo = Math.min(lo, f[i]);
    hi = Math.max(hi, f[i]);
  }
  for (let i = 0; i < f.length; i++) {
    const t = (f[i] - lo) / Math.max(1e-9, hi - lo);
    g.height[i] = Math.min(levels - 1, Math.floor(t * levels));
  }

  // Majority filter: a cell takes the most common height in its 3x3
  // neighbourhood when that height has at least 5 of the 9 cells.
  //
  for (let pass = 0; pass < 3; pass++) {
    const nh = Int8Array.from(g.height);
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const cnt = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(g.w - 1, Math.max(0, x + dx)),
                  ny = Math.min(g.h - 1, Math.max(0, y + dy)),
                  z  = g.z(nx, ny);
            cnt.set(z, (cnt.get(z) ?? 0) + 1);
          }
        }
        for (const [z, c] of cnt) {
          if (c >= 5) { nh[(y * g.w) + x] = z; }
        }
      }
    }
    g.height.set(nh);
  }

  // Merge small regions, smallest first, until none remain.
  //
  for (let guard = 0; guard < 1000; guard++) {
    const { id, size } = regions(g);
    let r = -1;
    for (let k = 0; k < size.length; k++) {
      if ( (size[k] < minBlob) && ( (r < 0) || (size[k] < size[r]) ) ) { r = k; }
    }
    if (r < 0) { return; }
    const touch = new Map<number, number>();
    for (let i = 0; i < id.length; i++) {
      if (id[i] !== r) { continue; }
      const x = i % g.w, y = (i / g.w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!g.inside(nx, ny)) { continue; }
        const j = (ny * g.w) + nx;
        if (id[j] !== r) { touch.set(g.height[j], (touch.get(g.height[j]) ?? 0) + 1); }
      }
    }
    if (!touch.size) { return; }
    const z = [...touch].sort((u, v) => v[1] - u[1])[0][0];
    for (let i = 0; i < id.length; i++) {
      if (id[i] === r) { g.height[i] = z; }
    }
  }
}

// Remove loops from a walk: when a cell repeats, drop the cells between
// its two visits.
//
function eraseLoops(cells: Pt[]): Pt[] {
  const out = [] as Pt[], at = new Map<string, number>();
  for (const c of cells) {
    const k = c[0] + "," + c[1], j = at.get(k);
    if (j !== undefined) {
      for (let m = j + 1; m < out.length; m++) { at.delete(out[m][0] + "," + out[m][1]); }
      out.length = j + 1;
      continue;
    }
    at.set(k, out.length);
    out.push(c);
  }
  return out;
}

// Breadth-first distance from a set of cells, ignoring obstacles.
//
function distanceFrom(g: Grid, src: Pt[]): Int32Array {
  const d = new Int32Array(g.w * g.h).fill(-1),
        q = [] as number[];
  for (const [x, y] of src) {
    const i = (y * g.w) + x;
    if (d[i] < 0) { d[i] = 0; q.push(i); }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (!g.inside(nx, ny)) { continue; }
      const j = (ny * g.w) + nx;
      if (d[j] >= 0) { continue; }
      d[j] = d[i] + 1;
      q.push(j);
    }
  }
  return d;
}

function attempt(p: GenParams, rng: Rng): { grid: Grid, routes: Route[], chokesX: number[] } {
  const L = p.length, W = p.width,
        STATION_LEN = p.stationLength,
        g = new Grid(L, W, Cell.GROUND);

  // Height first, so station rows can be chosen on level ground.
  //
  heightmap(g, rng, p.levels, p.hillScale, p.hillNoise, p.minBlob);
  if ( (p.startY !== null) && (p.startZ !== undefined) && (p.startZ !== null) ) {
    const shift = p.startZ - g.z(1, p.startY);
    for (let i = 0; i < g.height.length; i++) { g.height[i] = Math.max(0, Math.min(p.levels - 1, g.height[i] + shift)); }
  }

  // Stations: three cells along x near each end. A station, the cells
  // around it and the second row north (the station building stands on
  // the two rows north) must be on one level, and at the start station so must the
  // AHEAD cells east of it, where the first track goes, and one more, so
  // a ramp climbing east starts past them. A random row is chosen among the rows
  // where that holds; a fixed row that does not hold retries the attempt
  // (heights are never flattened, which would leave small notches).
  //
  const sx = 1, ex = L - 1 - STATION_LEN;
  const level = (px: number, py: number) => {
    const z = g.z(px, py);
    for (let y = py - HOUSE_ROWS; y <= (py + 1); y++) {
      for (let x = px - 1; x <= (px + STATION_LEN); x++) {
        if ( g.inside(x, y) && (g.z(x, y) !== z) ) { return false; }
      }
    }
    if (px === sx) {
      for (let x = px + STATION_LEN; x <= (px + STATION_LEN + AHEAD); x++) {
        if ( !g.inside(x, py) || (g.z(x, py) !== z) ) { return false; }
      }
    }
    return true;
  };
  const row = (fixed: number | null, px: number) => {
    if (fixed !== null) {
      if (!level(px, fixed)) { throw new RetryError("station not on level ground"); }
      return fixed;
    }
    const ok = [] as number[];
    for (let y = 2; y <= (W - 3); y++) {
      if (level(px, y)) { ok.push(y); }
    }
    if (!ok.length) { throw new RetryError("station not on level ground"); }
    return ok[rng.int(0, ok.length - 1)];
  };
  const sy = row(p.startY, sx),
        ey = row(p.endY,   ex);
  for (let i = 0; i < STATION_LEN; i++) {
    g.set(sx + i, sy, Cell.STATION);
    g.set(ex + i, ey, Cell.STATION);
  }

  // Choke walls, evenly spaced along x with some jitter.
  //
  const chokesX = [] as number[], thick = [] as number[];
  for (let i = 0; i < p.chokes; i++) {
    const base = Math.round((L * (i + 1)) / (p.chokes + 1));
    chokesX.push(base + rng.int(-3, 3));
    thick.push(rng.int(p.wallThickness[0], p.wallThickness[1]));
  }

  // Gap rows for each route at each wall. Route A stays in the middle
  // band; route B alternates between the top and bottom bands so it is
  // longer.
  //
  const bandLo = 2, bandHi = W - 3,
        third  = Math.floor((bandHi - bandLo) / 3);
  const gapsA = [] as number[], gapsB = [] as number[],
        yA    = [] as number[], yB    = [] as number[];
  const flip  = rng.chance(0.5);
  for (let i = 0; i < p.chokes; i++) {
    gapsA.push(rng.int(p.narrowGap[0], p.narrowGap[1]));
    gapsB.push(rng.int(p.wideGap[0],   p.wideGap[1]));
    const top = ( ((i % 2) === 0) !== flip );

    // With a separation hint, both gaps move: every pair of rows that
    // fits is scored by how far its separation is from the hint (from
    // the largest possible for -1); ties go to route A nearest the middle
    // row, then to route B on this wall's side, then at random.
    //
    if (p.chokeSeparation !== 0) {
      const na = gapsA[i], nb = gapsB[i], mid = (W - 1) / 2,
            best = [] as [number, number][];
      let bestKey = [Infinity, Infinity, Infinity];
      for (let a0 = 0; (a0 + na) <= W; a0++) {
        for (let b0 = 0; (b0 + nb) <= W; b0++) {
          const above = ((b0 + nb) <= a0),
                sep   = ( above ? (a0 - (b0 + nb)) : (b0 - (a0 + na)) );
          if (sep < MIN_SEP) { continue; }
          const key = [( (p.chokeSeparation < 0) ? -sep : Math.abs(sep - p.chokeSeparation) ),
                       Math.abs((a0 + ((na - 1) / 2)) - mid), ( (above === top) ? 0 : 1 )];
          const cmp = ( (key[0] !== bestKey[0]) ? (key[0] - bestKey[0]) :
                      ( (key[1] !== bestKey[1]) ? (key[1] - bestKey[1]) : (key[2] - bestKey[2]) ) );
          if (cmp < 0) { bestKey = key; best.length = 0; }
          if (cmp <= 0) { best.push([a0, b0]); }
        }
      }
      if (!best.length) { throw new RetryError("no room for route B's gap"); }
      const [a0, b0] = best[rng.int(0, best.length - 1)];
      yA.push(a0 + Math.floor((na - 1) / 2));
      yB.push(b0 + Math.floor((nb - 1) / 2));
      continue;
    }
    yA.push(rng.int(bandLo + third, bandHi - third));

    // Route B's gap must lie fully inside the strip and leave at least
    // MIN_SEP rows of black rock between it and route A's gap, so the two
    // passes never merge. Prefer the side this wall alternates to.
    //
    const a0   = gapStart(yA[i], gapsA[i]),
          a1   = a0 + gapsA[i] - 1;
    const fits = (y: number) => {
      const b0 = gapStart(y, gapsB[i]), b1 = b0 + gapsB[i] - 1;
      return ( (b0 >= 0) && (b1 <= (W - 1)) &&
               ( ((b1 + MIN_SEP) < a0) || ((a1 + MIN_SEP) < b0) ) );
    };
    const above = [] as number[], below = [] as number[];
    for (let y = 0; y < W; y++) {
      if (!fits(y)) { continue; }
      if (y < yA[i]) { above.push(y); }
      else           { below.push(y); }
    }
    const first = ( top ? above : below ), second = ( top ? below : above ),
          pick  = ( first.length ? first : second );
    if (!pick.length) { throw new RetryError("no room for route B's gap"); }

    // Within the chosen side, favour rows far from route A for a longer
    // detour.
    //
    pick.sort((u, v) => Math.abs(v - yA[i]) - Math.abs(u - yA[i]));
    yB.push(pick[rng.int(0, Math.min(pick.length, 4) - 1)]);
  }

  // Forced routes. Each passes straight through its gap in every wall.
  //
  const routes = [] as Route[];
  for (const [name, ys, gaps] of [["A", yA, gapsA], ["B", yB, gapsB]] as [string, number[], number[]][]) {
    const cells = [] as Pt[];
    let cur: Pt = [sx + STATION_LEN, sy];
    cells.push(cur);
    for (let i = 0; i < p.chokes; i++) {
      const inA: Pt = [chokesX[i] - 2,            ys[i]],
            out: Pt = [chokesX[i] + thick[i] + 1, ys[i]];
      walk(rng, cur, inA, W, 0.25, cells);
      walk(rng, inA, out, W, 0, cells);
      cur = out;
    }
    walk(rng, cur, [ex - 1, ey], W, 0.25, cells);
    const full = eraseLoops([[sx + STATION_LEN - 1, sy] as Pt].concat(cells, [[ex, ey] as Pt]));
    routes.push({ name, cells: full, gaps });
  }

  const forced = new Uint8Array(L * W);
  for (const r of routes) {
    for (const [x, y] of r.cells) { forced[(y * L) + x] = 1; }
  }
  const isStation = (x: number, y: number) => (g.get(x, y) === Cell.STATION);

  // Walls: black rock across the strip, ragged by a cell on each side,
  // with each route's gap cleared around its crossing row.
  //
  for (let i = 0; i < p.chokes; i++) {
    for (let y = 0; y < W; y++) {
      const x0 = chokesX[i] - rng.int(0, 1),
            x1 = chokesX[i] + thick[i] - 1 + rng.int(0, 1);
      for (let x = x0; x <= x1; x++) { g.set(x, y, Cell.BLACKROCK); }
    }
    for (const [ys, gaps] of [[yA, gapsA], [yB, gapsB]] as [number[], number[]][]) {
      const y0 = gapStart(ys[i], gaps[i]);
      for (let y = y0; y < (y0 + gaps[i]); y++) {
        for (let x = chokesX[i] - 1; x <= (chokesX[i] + thick[i]); x++) {
          if (g.inside(x, y)) { g.set(x, y, Cell.GROUND); forced[(y * L) + x] = 1; }
        }
      }
    }
  }

  // Seed and grow features. Black rock and water stay off forced cells.
  // Trees and rock grow only on ground and stay out of route A's sparse
  // zone.
  //
  const dA = distanceFrom(g, routes[0].cells),
        dB = distanceFrom(g, routes[1].cells);
  const sparse = (x: number, y: number) => {
    const i = (y * L) + x;
    return ( (dA[i] <= p.sparseRadius) && (dB[i] > p.sparseRadius) );
  };
  const onGround = (x: number, y: number) => (g.get(x, y) === Cell.GROUND);
  const nearStation = (x: number, y: number) =>
    ( ( (Math.abs(y - sy) <= 2) && (x >= (sx - 2)) && (x <= (sx + STATION_LEN + 1)) ) ||
      ( (Math.abs(y - ey) <= 2) && (x >= (ex - 2)) && (x <= (ex + STATION_LEN + 1)) ) );
  const blocker  = (x: number, y: number) => ( onGround(x, y) && !forced[(y * L) + x] && !isStation(x, y) && !nearStation(x, y) );
  // The station building stands on the rows north of the station, so
  // no trees or grey rock grow there.
  //
  const houseRow = (x: number, y: number) =>
    ( ( (y < sy) && (y >= (sy - HOUSE_ROWS)) && (x >= (sx - 1)) && (x <= (sx + STATION_LEN)) ) ||
      ( (y < ey) && (y >= (ey - HOUSE_ROWS)) && (x >= (ex - 1)) && (x <= (ex + STATION_LEN)) ) );
  const resource = (x: number, y: number) => ( onGround(x, y) && !sparse(x, y) && !houseRow(x, y) );

  const area  = L * W,
        count = (d: number) => Math.round((area * d) / 1000);
  // Ponds stay on one height level.
  //
  const seed  = (n: number, lo: number, hi: number, c: CellType, ok: (x: number, y: number) => boolean) => {
    for (let k = 0; k < n; k++) {
      const x = rng.int(0, L - 1), y = rng.int(0, W - 1), z = g.z(x, y),
            okz = ( (c === Cell.WATER) ? ((u: number, v: number) => ( ok(u, v) && (g.z(u, v) === z) )) : ok );
      grow(g, rng, x, y, rng.int(lo, hi), c, okz);
    }
  };

  seed(count(p.blackrockDensity), p.blackrockSize[0], p.blackrockSize[1], Cell.BLACKROCK, blocker);
  seed(count(p.pondDensity),      p.pondSize[0],      p.pondSize[1],      Cell.WATER,     blocker);
  seed(count(p.rockDensity),      p.rockSize[0],      p.rockSize[1],      Cell.ROCK,      resource);
  seed(count(p.forestDensity),    p.forestSize[0],    p.forestSize[1],    Cell.TREE,      resource);

  // Black rock mountains: each black rock cell rises by one level per
  // `mountainStep` cells of distance from the nearest non-black-rock cell.
  //
  const inside = new Int32Array(L * W).fill(-1), q = [] as number[];
  for (let i = 0; i < (L * W); i++) {
    if (g.cells[i] !== Cell.BLACKROCK) { inside[i] = 0; q.push(i); }
  }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % L, y = (i / L) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!g.inside(nx, ny)) { continue; }
      const j = (ny * L) + nx;
      if (inside[j] >= 0) { continue; }
      inside[j] = inside[i] + 1;
      q.push(j);
    }
  }
  for (let i = 0; i < (L * W); i++) {
    if (g.cells[i] !== Cell.BLACKROCK) { continue; }
    const d = ( (inside[i] >= 0) ? inside[i] : 1 );
    g.height[i] += Math.min(p.mountainMax, Math.ceil(d / p.mountainStep));
  }

  // Scattered ramps on level boundaries. A cell qualifies if it is ground,
  // the cell uphill of it is solid and one level up, and the cell behind
  // it is at its level, so track could run along the ramp.
  //
  if (p.rampChance > 0) {
    const solidTop = (c: number) => ( (c === Cell.GROUND) || (c === Cell.ROCK) || (c === Cell.BLACKROCK) || (c === Cell.TREE) );
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < L; x++) {
        if (g.get(x, y) !== Cell.GROUND) { continue; }
        const z = g.z(x, y), ok = [] as number[];
        for (let d = 0; d < 4; d++) {
          const ux = x + DIRS[d][0], uy = y + DIRS[d][1],
                bx = x - DIRS[d][0], by = y - DIRS[d][1];
          if ( !g.inside(ux, uy) || !g.inside(bx, by) ) { continue; }
          if ( (g.z(ux, uy) === (z + 1)) && solidTop(g.get(ux, uy)) &&
               (g.z(bx, by) === z) && (g.get(bx, by) !== Cell.WATER) ) {
            ok.push(d);
          }
        }
        if ( !ok.length || !rng.chance(p.rampChance) ) { continue; }
        g.set(x, y, Cell.RAMP_GROUND);
        g.dir[(y * L) + x] = ok[rng.int(0, ok.length - 1)];
      }
    }
  }

  clearStations(g, sx, sy, ex, ey, STATION_LEN);
  dryWater(g);
  return { grid: g, routes, chokesX };
}

// Plain ground the train's first track runs over, east of the start
// station.
//
export const AHEAD = 3;

// Rows north of a station kept for the station building.
//
export const HOUSE_ROWS = 2;

// Plain ground at the station's height on the ring of cells around each
// station, on the second row north (under the station building), and on
// the AHEAD cells east of the start station. Ramps left
// pointing at a changed cell no longer lead anywhere, so they go back to
// ground.
//
function clearStations(g: Grid, sx: number, sy: number, ex: number, ey: number, len: number): void {
  const clear = (x: number, y: number, z: number) => {
    if (!g.inside(x, y)) { return; }
    g.set(x, y, Cell.GROUND); g.setZ(x, y, z); g.dir[(y * g.w) + x] = DIR_NONE;
  };
  for (const [px, py, ahead] of [[sx, sy, AHEAD], [ex, ey, 0]]) {
    const z = g.z(px, py);
    for (let y = py - HOUSE_ROWS; y <= (py + 1); y++) {
      for (let x = px - 1; x <= (px + len); x++) {
        if (y !== py) { clear(x, y, z); }
        else if ( (x < px) || (x >= (px + len)) ) { clear(x, y, z); }
      }
    }
    for (let x = px + len; x < (px + len + ahead); x++) { clear(x, py, z); }
  }
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = (y * g.w) + x;
      if (!isRamp(g.cells[i])) { continue; }
      const d = g.dir[i], ux = x + DIRS[d][0], uy = y + DIRS[d][1], bx = x - DIRS[d][0], by = y - DIRS[d][1];
      if ( !g.inside(ux, uy) || !g.inside(bx, by) || (g.z(ux, uy) !== (g.z(x, y) + 1)) || (g.z(bx, by) !== g.z(x, y)) ) {
        g.set(x, y, ( (g.cells[i] === Cell.RAMP_BLACKROCK) ? Cell.BLACKROCK : Cell.GROUND ));
        g.dir[i] = DIR_NONE;
      }
    }
  }
}

// Whether a ramp stands on a station's ring or on the AHEAD cells east
// of the start station, which must stay plain ground.
//
function stationRamp(g: Grid, a: Analysis): boolean {
  for (const [st, ahead] of [[a.stations.start, AHEAD], [a.stations.end, 0]] as [Pt[], number][]) {
    const x0 = Math.min(...st.map(q => q[0])), x1 = Math.max(...st.map(q => q[0])), y0 = st[0][1];
    for (let y = y0 - 1; y <= (y0 + 1); y++) {
      for (let x = x0 - 1; x <= (x1 + 1 + ( (y === y0) ? ahead : 0 )); x++) {
        if ( g.inside(x, y) && isRamp(g.get(x, y)) ) { return true; }
      }
    }
  }
  return false;
}

// Water is held in on every side: each water cell's side neighbours are
// inside the level and at least as high, so no water face hangs over
// open air. Water that is not held in becomes ground, until none is left.
//
export function dryWater(g: Grid): void {
  for (let changed = true; changed; ) {
    changed = false;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (g.get(x, y) !== Cell.WATER) { continue; }
        const z = g.z(x, y);
        const open = DIRS.some(([dx, dy]) => ( !g.inside(x + dx, y + dy) || (g.z(x + dx, y + dy) < z) ));
        if (open) { g.set(x, y, Cell.GROUND); changed = true; }
      }
    }
  }
}

// Track and nearby resources for one forced route. Its resource ratio
// uses all reachable resources, since players may gather anywhere.
//
function routeStats(g: Grid, route: Route, a: Analysis, rules: Rules, radius: number): RouteStats {
  const reach = reachable(g, a.stations),
        d     = distanceFrom(g, route.cells);
  let nearTrees = 0, nearRock = 0, track = 0;
  for (const [x, y] of route.cells) {
    if (g.get(x, y) !== Cell.STATION) { track++; }
  }
  for (let i = 0; i < d.length; i++) {
    if ( !reach[i] || (d[i] > radius) ) { continue; }
    if      (g.cells[i] === Cell.TREE) { nearTrees++; }
    else if (g.cells[i] === Cell.ROCK) { nearRock++; }
  }
  // Approximate: one ramp per level change along the route as drawn.
  //
  let changes = 0;
  for (let k = 0; (k + 1) < route.cells.length; k++) {
    const u = route.cells[k], v = route.cells[k + 1];
    if (g.z(u[0], u[1]) !== g.z(v[0], v[1])) { changes++; }
  }
  const rc = resourceCheck(track, 0, changes, a.reachTrees, a.reachRock, rules);
  return { name: route.name, track, gaps: route.gaps, nearTrees, nearRock,
           feasible: rc.feasible, ratio: rc.ratio };
}

// Reject parameters that can never produce a level, before any attempt.
//
export function checkParams(p: GenParams): void {
  const bad = (m: string) => { throw new Error("bad parameter: " + m); };
  const int = (v: number) => ( Number.isInteger(v) );

  if ( !int(p.seed) )                                  { bad("seed must be an integer"); }
  if ( !int(p.chokes) || (p.chokes < 0) )              { bad("chokes must be an integer >= 0"); }
  if ( !int(p.width)  || (p.width < 10) )              { bad("width must be an integer >= 10"); }
  const wt = p.wallThickness;
  if ( !int(p.chokeSeparation) || (p.chokeSeparation < -1) ) { bad("choke separation must be an integer >= -1"); }
  if ( !int(wt[0]) || !int(wt[1]) || (wt[0] < 1) || (wt[1] < wt[0]) ) { bad("wall thickness range must satisfy 1 <= min <= max"); }

  // Each stretch between walls (and the stations) needs about 9 cells
  // plus the thickest wall.
  //
  const minLen = ((p.chokes + 1) * (9 + Math.max(3, wt[1]))) + 8;
  if ( !int(p.length) || (p.length < minLen) ) {
    bad("length must be an integer >= " + minLen + " for " + p.chokes + " chokes of thickness up to " + Math.max(3, wt[1]));
  }
  if ( !(p.C > 0) )                                    { bad("C must be > 0"); }
  if ( !(p.bridgeTrees >= 0) )                         { bad("bridge trees must be >= 0"); }
  if ( !int(p.maxAttempts) || (p.maxAttempts < 1) )    { bad("max attempts must be an integer >= 1"); }
  if ( !int(p.stationLength) || (p.stationLength < 1) || (p.stationLength > 12) ) { bad("station length must be an integer in [1, 12]"); }
  for (const [k, v] of [["trees", p.forestDensity], ["rock", p.rockDensity],
                        ["blackrock", p.blackrockDensity], ["water", p.pondDensity]] as [string, number][]) {
    if ( !(v >= 0) || (v > 1000) ) { bad(k + " density must be in [0, 1000]"); }
  }
  for (const [k, r] of [["narrow gap", p.narrowGap], ["wide gap", p.wideGap]] as [string, [number, number]][]) {
    if ( !int(r[0]) || !int(r[1]) || (r[0] < 1) || (r[1] < r[0]) || (r[1] > (p.width - 4)) ) {
      bad(k + " range must satisfy 1 <= min <= max <= width - 4");
    }
  }
  if ( !int(p.levels) || (p.levels < 1) || (p.levels > 16) ) { bad("levels must be an integer in [1, 16]"); }
  if ( !(p.hillScale >= 2) )                           { bad("hill scale must be >= 2"); }
  if ( !(p.hillNoise >= 0) )                           { bad("hill noise must be >= 0"); }
  if ( !int(p.minBlob) || (p.minBlob < 1) )            { bad("min blob must be an integer >= 1"); }
  if ( !(p.mountainStep >= 1) )                        { bad("mountain step must be >= 1"); }
  if ( !int(p.mountainMax) || (p.mountainMax < 0) )    { bad("mountain max must be an integer >= 0"); }
  if ( (p.levels + p.mountainMax) > 30 )               { bad("levels + mountain max must be <= 30"); }
  if ( !(p.rampChance >= 0) || (p.rampChance > 1) )    { bad("ramp chance must be in [0, 1]"); }
  for (const [k, y] of [["start-y", p.startY], ["end-y", p.endY]] as [string, number | null][]) {
    if ( (y !== null) && ( !int(y) || (y < 0) || (y >= p.width) ) ) { bad(k + " must be a row in [0, width - 1]"); }
  }
}

// Generate, validate, retry. Throws if no attempt passes.
//
export function generate(p: GenParams): Level {
  checkParams(p);
  const rules: Rules = { C: p.C, bridgeTrees: p.bridgeTrees };
  const why = new Map<string, number>(),
        fail = (r: string) => { why.set(r, (why.get(r) ?? 0) + 1); };
  for (let k = 0; k < p.maxAttempts; k++) {
    const rng = new Rng((p.seed * 1000003) + k);
    let made;
    try { made = attempt(p, rng); }
    catch (e) {
      if (e instanceof RetryError) { fail(e.message); continue; }
      throw e;
    }
    const { grid, routes, chokesX } = made;
    let a = analyze(grid, rules);
    if ( a.cheapest && a.cheapest.reusesColumn ) { fail("cheapest track uses a column twice"); continue; }

    // Build the cheapest track's ramps into the level, then re-check: the
    // level is judged as shipped.
    //
    if ( p.pathRamps && a.cheapest ) {
      for (const st of a.cheapest.steps) {
        if ( (st.kind !== "ramp") || st.built || st.bridge ) { continue; }
        const i = (st.y * grid.w) + st.x;
        grid.cells[i] = Cell.RAMP_GROUND;
        grid.dir[i]   = st.dir;
      }
      a = analyze(grid, rules);
      if ( a.cheapest && a.cheapest.reusesColumn ) { fail("cheapest track uses a column twice"); continue; }
    }
    if (stationRamp(grid, a))     { fail("a ramp next to a station or ahead of the start"); continue; }
    if (!a.cheapest)              { fail("start and end not connected"); continue; }
    if (!a.feasible)              { fail("not enough reachable trees or rock for the cheapest path"); continue; }
    if (a.ratio < p.minRatio)     { fail("cheapest path ratio below min-ratio"); continue; }
    const rs = routes.map(r => routeStats(grid, r, a, rules, p.sparseRadius));
    if (rs.some(s => ( !s.feasible || (s.ratio < p.minRatio) ))) { fail("a forced route lacks resources"); continue; }
    return { params: p, attempt: k, grid, routes, chokesX, analysis: a, routeStats: rs };
  }
  const reasons = [...why].sort((u, v) => v[1] - u[1]).map(([r, n]) => "  " + n + " x " + r).join("\n");
  throw new Error("no valid level after " + p.maxAttempts + " attempts (seed " + p.seed + "). Rejections:\n" + reasons);
}
