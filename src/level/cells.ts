// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Cell types. Values are the Tiled local tile IDs of the cell tileset,
// so a cell's Tiled GID is (value + 1) and GID 0 is open air.
//
export const Cell = {
  AIR            : -1,
  GROUND         : 0,
  TREE           : 1,
  WATER          : 2,
  ROCK           : 3,
  BLACKROCK      : 4,
  STATION        : 5,
  RAMP_GROUND    : 6,
  RAMP_BLACKROCK : 7,
  TRACK          : 8,
} as const;

export type CellType = (typeof Cell)[keyof typeof Cell];

export const CELL_NAMES: Record<number, string> = {
  [Cell.AIR]            : "air",
  [Cell.GROUND]         : "ground",
  [Cell.TREE]           : "tree",
  [Cell.WATER]          : "water",
  [Cell.ROCK]           : "rock",
  [Cell.BLACKROCK]      : "blackrock",
  [Cell.STATION]        : "station",
  [Cell.RAMP_GROUND]    : "ramp",
  [Cell.RAMP_BLACKROCK] : "ramp_blackrock",
  [Cell.TRACK]          : "track",
};

export const TILE_COUNT = 9;

// Names used by older level files.
//
const OLD_NAMES: Record<string, string> = { ramp_ground: "ramp" };

export function cellFromName(name: string): CellType {
  name = OLD_NAMES[name] ?? name;
  for (const k of Object.keys(CELL_NAMES)) {
    if (CELL_NAMES[Number(k)] === name) { return Number(k) as CellType; }
  }
  throw new Error("unknown cell name: " + name);
}

// Uphill directions for ramps: north (-y), east (+x), south (+y), west (-x).
//
// Height of one ground level, in cells (the page draws a level's top at
// (height + 1) * LEVEL_Y; thrown dynamite flies in the same units).
//
export const LEVEL_Y = 0.5;

export const DIR_NONE = -1;
export const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const DIR_NAMES = ["north", "east", "south", "west"];

// A level as a 2.5D surface. Width is the long axis (x, start to end),
// height is the short axis (y). Each column has a surface cell type, a
// surface height, and for ramp cells the uphill direction.
//
export class Grid {
  w      : number;
  h      : number;
  cells  : Int8Array;
  height : Int8Array;
  dir    : Int8Array;

  constructor(w: number, h: number, fill: CellType) {
    this.w      = w;
    this.h      = h;
    this.cells  = new Int8Array(w * h).fill(fill);
    this.height = new Int8Array(w * h);
    this.dir    = new Int8Array(w * h).fill(DIR_NONE);
  }

  inside(x: number, y: number): boolean {
    return ( (x >= 0) && (x < this.w) && (y >= 0) && (y < this.h) );
  }

  get(x: number, y: number): CellType {
    return this.cells[(y * this.w) + x] as CellType;
  }

  set(x: number, y: number, c: CellType): void {
    this.cells[(y * this.w) + x] = c;
  }

  z(x: number, y: number): number {
    return this.height[(y * this.w) + x];
  }

  setZ(x: number, y: number, z: number): void {
    this.height[(y * this.w) + x] = z;
  }
}

export function isRamp(c: number): boolean {
  return ( (c === Cell.RAMP_GROUND) || (c === Cell.RAMP_BLACKROCK) );
}

// Whether an avatar (or track) can step between neighbouring cells i and
// j, considering height only. A ramp at height z with uphill direction d
// joins its front neighbour (in direction d) only if that neighbour is at
// z + 1, and joins its other neighbours only at z. Any other pair joins
// only at equal height. Cell types (water, black rock) are checked
// separately.
//
export function joins(g: Grid, i: number, j: number): boolean {
  const xi = i % g.w, yi = (i / g.w) | 0,
        xj = j % g.w, yj = (j / g.w) | 0,
        zi = g.height[i], zj = g.height[j];
  const front = (k: number, kx: number, ky: number, ox: number, oy: number) => {
    const d = g.dir[k];
    return ( (d !== DIR_NONE) && ((kx + DIRS[d][0]) === ox) && ((ky + DIRS[d][1]) === oy) );
  };
  if ( isRamp(g.cells[i]) && front(i, xi, yi, xj, yj) ) { return (zj === (zi + 1)); }
  if ( isRamp(g.cells[j]) && front(j, xj, yj, xi, yi) ) { return (zi === (zj + 1)); }
  return (zi === zj);
}
