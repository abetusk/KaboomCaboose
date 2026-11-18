// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Plain JSON level format, for readers that do not want to deal with
// Tiled's layers and flip bits. Arrays are row-major: index = y * length + x.
//
//   cells   : cell type index into `types`
//   heights : surface height level
//   ramps   : uphill direction index into `directions`, or -1
//

import { CELL_NAMES, DIR_NAMES, TILE_COUNT, Grid } from "./cells.ts";

export function toJson(g: Grid, meta: Record<string, unknown>): object {
  const types = [] as string[];
  for (let i = 0; i < TILE_COUNT; i++) { types.push(CELL_NAMES[i]); }
  return {
    format     : "voxel-rail-level",
    version    : 1,
    license    : "CC0-1.0",
    length     : g.w,
    width      : g.h,
    types,
    directions : DIR_NAMES,
    cells      : Array.from(g.cells),
    heights    : Array.from(g.height),
    ramps      : Array.from(g.dir),
    ...meta,
  };
}
