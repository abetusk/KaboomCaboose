// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The test run (2026-11-16): a few short levels made by hand, for trying
// out the parts of a run quickly (laying track, stations, upgrades,
// wagons, dynamite) rather than for play. All flat on one height, no
// black rock, no water; stations on the middle row, a row of grey rock
// along the top edge and a row of trees along the bottom. Levels join as
// in a generated run (src/gen/run.ts), each end station being the next
// level's start station. The room puts a pile of track beside each
// station (testPiles).
//

import { Cell, Grid } from "../level/cells.ts";
import type { Run } from "./run.ts";
import type { World } from "../sim/world.ts";
import { Item } from "../sim/world.ts";

// Cells of track between one station and the next (2026-11-16: short,
// so a level is laid in moments), and the level length that gives: the
// gap, two stations, and a cell at each end.
//
export const TEST_GAP = 10;

export function testLength(stationLength: number): number { return ( TEST_GAP + (2 * stationLength) + 2 ); }

// Track beside each station: TEST_PILES piles of TEST_PILE pieces, twice
// what a level needs.
//
export const TEST_PILE  = 10,
             TEST_PILES = 2;

export function testRun(levels: number, width: number, stationLength: number): Run {
  const length = testLength(stationLength);
  const S = stationLength, step = length - S - 2, W = length + ((levels - 1) * step),
        g = new Grid(W, width, Cell.GROUND), sy = Math.floor(width / 2), offsets = [] as number[];
  for (let x = 0; x < W; x++) {
    g.set(x, 0, Cell.ROCK);
    g.set(x, width - 1, Cell.TREE);
  }
  for (let k = 0; k < levels; k++) {
    const off = k * step;
    offsets.push(off);
    for (const x0 of [off + 1, off + length - 1 - S]) {
      for (let i = 0; i < S; i++) { g.set(x0 + i, sy, Cell.STATION); }
    }
  }
  return { grid: g, offsets };
}

// The piles stand on the two cells east of each station's east end, one
// and two rows north of it (the start pad and the first pile are south).
//
export function testPiles(w: World): void {
  for (const st of w.stations) {
    const [x, y] = st[st.length - 1];
    for (const [dx, dy] of [[1, -1], [2, -1], [1, -2], [2, -2]].slice(0, TEST_PILES)) {
      if (!w.inside(x + dx, y + dy)) { continue; }
      const i = w.idx(x + dx, y + dy);
      if (w.stack[i]) { continue; }
      w.stack[i] = Item.TRACK;
      w.count[i] = TEST_PILE;
    }
  }
}
