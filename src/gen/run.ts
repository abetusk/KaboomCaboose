// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// A run of levels as one world (D6.4). Levels are generated one after
// another, each starting on the row and at the height of the previous
// level's end station, and laid side by side so that each end station is
// also the next level's start station. A level and the next overlap by
// the station and one column either side (stationLength + 2 columns). In
// the overlap the earlier level's cells are kept: around the station
// both agree (the generator clears that ground on one height), and the
// earlier level's track route into the station may pass through the
// overlap, while the next level's route leaves the station east along
// its row. Each level is then checked again as laid (the same analysis
// the generator uses) and made again with another seed if it fails.
//

import { Cell, Grid, DIRS, DIR_NONE, isRamp } from "../level/cells.ts";
import { generate, type GenParams } from "./generate.ts";
import { analyze, findStations } from "./analyze.ts";

export interface Run {
  grid    : Grid;

  // West edge of each level in the run's columns.
  //
  offsets : number[];
}

// Tries per level before giving up.
//
const TRIES = 20;

// Columns one level moves the next along: the next level's start station
// (at x = 1) lands on this level's end station (at x = length - 1 -
// stationLength).
//
export function runStep(p: GenParams): number { return ( p.length - p.stationLength - 2 ); }

export function runWidth(p: GenParams, levels: number): number { return ( p.length + ((levels - 1) * runStep(p)) ); }

// A ramp must climb one height toward its `dir` from ground at its own
// height behind it; ones the joining broke become plain ground (or black
// rock), as the generator does near stations.
//
function fixRamps(g: Grid): void {
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

// Columns x0 to x0 + w - 1 of g as a grid of their own.
//
function columns(g: Grid, x0: number, w: number): Grid {
  const out = new Grid(w, g.h, Cell.GROUND);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * g.w) + x0 + x, j = (y * w) + x;
      out.cells[j] = g.cells[i]; out.height[j] = g.height[i]; out.dir[j] = g.dir[i];
    }
  }
  return out;
}

// `levels` levels of p's size, seeds counting up from p.seed. Throws if
// a level cannot be made.
//
export function generateRun(p: GenParams, levels: number): Run {
  const step  = runStep(p), L = p.length, over = p.stationLength + 2,
        grid  = new Grid(runWidth(p, levels), p.width, Cell.GROUND),
        rules = { C: p.C, bridgeTrees: p.bridgeTrees },
        offsets = [] as number[];
  let endY: number | null = p.startY, endZ: number | null = null, seed = p.seed;
  for (let k = 0; k < levels; k++) {
    const off = k * step;
    let done = false, why = "";
    for (let t = 0; ( (t < TRIES) && !done ); t++, seed++) {
      let lv;
      try {
        lv = generate({ ...p, seed, startY: endY, startZ: endZ, endY: ( (k === (levels - 1)) ? p.endY : null ) });
      }
      catch (e) {
        why = (e as Error).message.split("\n")[0];
        continue;
      }

      // Lay it down, keeping the previous level's cells in the overlap.
      // Saved first, so a level that fails the check can be taken back.
      //
      const x0 = ( k ? over : 0 ), before = columns(grid, off, L);
      for (let y = 0; y < p.width; y++) {
        for (let x = x0; x < L; x++) {
          const i = (y * grid.w) + off + x, j = (y * L) + x;
          grid.cells[i] = lv.grid.cells[j]; grid.height[i] = lv.grid.height[j]; grid.dir[i] = lv.grid.dir[j];
        }
      }
      fixRamps(grid);
      const a = analyze(columns(grid, off, L), rules);
      if ( !a.cheapest || !a.feasible || (a.ratio < p.minRatio) ) {
        why = "level " + (k + 1) + " no longer passes once joined";
        for (let y = 0; y < p.width; y++) {
          for (let x = 0; x < L; x++) {
            const i = (y * grid.w) + off + x, j = (y * L) + x;
            grid.cells[i] = before.cells[j]; grid.height[i] = before.height[j]; grid.dir[i] = before.dir[j];
          }
        }
        continue;
      }
      const end = findStations(lv.grid).end[0];
      endY = end[1];
      endZ = lv.grid.z(end[0], end[1]);
      offsets.push(off);
      done = true;
    }
    if (!done) { throw new Error("could not make level " + (k + 1) + " of the run: " + why); }
  }
  return { grid, offsets };
}
