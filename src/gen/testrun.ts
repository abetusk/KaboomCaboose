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
// station (testPiles), lays track behind the first start station
// (testTrack), and the train starts with a dynamite wagon
// holding a stick (testTrain).
//

import { Cell, Grid } from "../level/cells.ts";
import type { Run } from "./run.ts";
import type { World } from "../sim/world.ts";
import type { Game } from "../sim/game.ts";
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

// Columns added west of the first level, for track behind its start
// station (testTrack): with the dynamite wagon the train is longer than
// a station, and it stands only on track.
//
export const TEST_BACK = 2;

export function testRun(levels: number, width: number, stationLength: number): Run {
  const length = testLength(stationLength);
  const S = stationLength, step = length - S - 2, W = TEST_BACK + length + ((levels - 1) * step),
        g = new Grid(W, width, Cell.GROUND), sy = Math.floor(width / 2), offsets = [] as number[];
  for (let x = 0; x < W; x++) {
    g.set(x, 0, Cell.ROCK);
    g.set(x, width - 1, Cell.TREE);
  }
  for (let k = 0; k < levels; k++) {
    const off = TEST_BACK + (k * step);
    offsets.push( (k === 0) ? 0 : off );
    for (const x0 of [off + 1, off + length - 1 - S]) {
      for (let i = 0; i < S; i++) { g.set(x0 + i, sy, Cell.STATION); }
    }
  }
  return { grid: g, offsets };
}

// Track on the TEST_BACK cells west of the first start station, joined
// to it, so the train's back wagons stand on the line. Before the game
// is made: the train is placed along the line.
//
export function testTrack(w: World): void {
  const [x0, y] = w.stations[0][0];
  for (let x = x0 - TEST_BACK; x < x0; x++) {
    if (!w.inside(x, y)) { continue; }
    const i = w.idx(x, y);
    w.track[i] = 1;
    w.conn[i] |= ( (x > (x0 - TEST_BACK)) ? ((1 << 1) | (1 << 3)) : (1 << 1) );
  }
  w.conn[w.idx(x0, y)] |= (1 << 3);
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

// The train starts with the dynamite wagon, as if its upgrade had been
// taken (so the upgrades that need it are offered), holding TEST_STICKS
// sticks (2026-11-19: dynamite and its upgrades can be tried at once).
//
export const TEST_STICKS = 1;

export function testTrain(g: Game): void {
  g.taken["dynamiteWagon"] = 1;
  g.train.cars   = [...g.train.cars, "dynamite"];
  g.train.sticks = TEST_STICKS;
  g.shapeTrain();
}
