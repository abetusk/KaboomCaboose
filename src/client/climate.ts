// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Weather per level (2026-11-20, D11.20): each level of a run is clear,
// rainy or snowy, drawn from view.rainChance and view.snowChance with
// the room's seed, so everyone in the room sees the same. Between two
// levels the weather changes across the station they share, mixing over
// view.weatherBlendCells as the level palettes do (src/client/palette.ts
// levelAt).
//

import { levelAt } from "./palette.ts";

export type Weather = "clear" | "rain" | "snow";

function hash(i: number): number {
  let x = (i + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ( (x ^ (x >>> 16)) >>> 0 );
}

// Level k's weather in the run of `seed`.
//
export function weatherOf(seed: number, k: number, rainChance: number, snowChance: number): Weather {
  const u = hash((Math.round(seed) * 7919) + (k * 104729) + 31) / 4294967296,
        r = Math.max(0, rainChance), s = Math.max(0, snowChance);
  if (u < r)       { return "rain"; }
  if (u < (r + s)) { return "snow"; }
  return "clear";
}

// The weather over the level's cells: the levels' weathers and the x of
// the middles of the stations between them.
//
export class Climate {
  readonly levels : Weather[];
  readonly mids   : number[];
  readonly blend  : number;

  constructor(seed: number, mids: number[], rainChance: number, snowChance: number, blend: number) {
    this.mids   = [...mids].sort((a, b) => (a - b));
    this.levels = Array.from({ length: this.mids.length + 1 }, (_, k) => weatherOf(seed, k, rainChance, snowChance));
    this.blend  = blend;
  }

  // The weather at x; `key` a number for the draw across a boundary (a
  // cell index, or anything for a raindrop).
  //
  at(x: number, key: number): Weather {
    return this.levels[Math.min(this.levels.length - 1, levelAt(Math.floor(x), this.mids, this.blend, key))];
  }

  get any(): boolean { return this.levels.some(w => (w !== "clear")); }
}
