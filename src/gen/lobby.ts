// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The walk-in lobby's ground (2026-11-20; server/lobby.ts): a flat
// yard, LOBBY_W by LOBBY_H cells, grey rock along the top edge and trees
// along the bottom, with two stations on one row (a world needs two) so a
// train stands at the start one. South of the stations lie the circles,
// in two rows: the characters at the west and new runs at the east of
// the first, the open rooms along the second.
//

import { Cell, Grid } from "../level/cells.ts";

export const LOBBY_W = 26,
             LOBBY_H = 12;

// The stations' row; the circle rows.
//
const STATION_Y = 3,
      PICK_Y    = 6,
      ROOM_Y    = 9;

export function lobbyGrid(stationLength: number): Grid {
  const g = new Grid(LOBBY_W, LOBBY_H, Cell.GROUND);
  for (let x = 0; x < LOBBY_W; x++) {
    g.set(x, 0, Cell.ROCK);
    g.set(x, LOBBY_H - 1, Cell.TREE);
  }
  for (const x0 of [1, LOBBY_W - 1 - stationLength]) {
    for (let i = 0; i < stationLength; i++) { g.set(x0 + i, STATION_Y, Cell.STATION); }
  }
  return g;
}

// Circle centres, 3 cells apart: `characters` and `difficulties` many on
// the first row, ROOM_SLOTS on the second.
//
export const ROOM_SLOTS = 5;

export function lobbySpots(characters: number, difficulties: number): { character: [number, number][], create: [number, number][],
                                                                       join: [number, number][] } {
  const at = (x: number, y: number): [number, number] => [x + 0.5, y + 0.5];
  return {
    character : Array.from({ length: characters },   (_, k) => at(3 + (3 * k), PICK_Y)),
    create    : Array.from({ length: difficulties }, (_, k) => at((LOBBY_W - 3) - (3 * ((difficulties - 1) - k)), PICK_Y)),
    join      : Array.from({ length: ROOM_SLOTS },   (_, k) => at(3 + (5 * k), ROOM_Y)),
  };
}
