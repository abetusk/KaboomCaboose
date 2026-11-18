// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { Cell, DIRS, Grid } from "../src/level/cells.ts";
import { generate, DEFAULTS, type GenParams } from "../src/gen/generate.ts";
import { analyze, type Step } from "../src/gen/analyze.ts";
import { toTmj, tilesetTsj, fromTmj } from "../src/level/tiled.ts";

const SEEDS = 300;

const SOLID = new Set<number>([Cell.GROUND, Cell.ROCK, Cell.BLACKROCK, Cell.TREE]);

// Check a track against the building rules (docs/DESIGN.md D4.6-D4.14).
// Returns null if it is valid, otherwise the first problem found.
//
function checkTrack(g: Grid, steps: Step[]): string | null {
  const H = (p: Step) => g.height[(p.y * g.w) + p.x],
        C = (p: Step) => g.cells[(p.y * g.w) + p.x];
  if ( (steps[0].kind !== "station") || (steps[steps.length - 1].kind !== "station") ) { return "does not run station to station"; }
  for (let k = 0; k < steps.length; k++) {
    const p = steps[k];
    if      ( (p.kind === "station") && ( (C(p) !== Cell.STATION) || (H(p) !== p.z) ) ) { return "bad station step at " + p.x + "," + p.y; }
    else if ( (p.kind === "land") && ( !SOLID.has(C(p)) || (H(p) !== p.z) ) )          { return "land step not on solid ground at its height at " + p.x + "," + p.y; }
    else if ( (p.kind === "bridge") && ( (C(p) === Cell.STATION) || ( (H(p) >= p.z) && (C(p) !== Cell.WATER) ) || (H(p) > p.z) ) ) {
      return "bridge step not over water or lower ground at " + p.x + "," + p.y;
    }
    if (k === 0) { continue; }
    const q = steps[k - 1];
    if ((Math.abs(p.x - q.x) + Math.abs(p.y - q.y)) !== 1) { return "steps not adjacent at " + p.x + "," + p.y; }
    if (p.kind === "ramp") {
      const hi  = DIRS[p.dir],
            nxt = steps[k + 1];
      if (!nxt) { return "track ends on a ramp"; }
      const up   = ( ((nxt.x - p.x) === hi[0]) && ((nxt.y - p.y) === hi[1]) ),
            down = ( ((q.x - p.x) === hi[0])   && ((q.y - p.y) === hi[1]) );
      if (!up && !down) { return "track does not run along the ramp at " + p.x + "," + p.y; }
      const lowSide = ( up ? q : nxt ), highSide = ( up ? nxt : q );
      if ( ((p.x - lowSide.x) !== hi[0]) || ((p.y - lowSide.y) !== hi[1]) ) { return "track does not enter the ramp at its low end at " + p.x + "," + p.y; }
      if (lowSide.z !== p.z)        { return "ramp low end height mismatch at " + p.x + "," + p.y; }
      if (highSide.z !== (p.z + 1)) { return "ramp high end not one level up at " + p.x + "," + p.y; }
      if (p.built) {
        const i = (p.y * g.w) + p.x;
        if ( (C(p) !== Cell.RAMP_GROUND) || (g.dir[i] !== p.dir) || (H(p) !== p.z) ) { return "track uses a ramp that is not in the level at " + p.x + "," + p.y; }
      }
      else if ( p.bridge ? (H(p) >= p.z) : ( (H(p) !== p.z) || !SOLID.has(C(p)) ) ) { return "ramp not on solid ground or a bridge at " + p.x + "," + p.y; }
      continue;
    }
    if ( (q.kind !== "ramp") && (q.z !== p.z) ) { return "level change without a ramp at " + p.x + "," + p.y; }
  }
  return null;
}

// Structure tests (walls, routes, ramps, round trips) use C = 5 so that
// resource shortage on small strips does not hide structural failures.
// Resource balance at the default C is tested separately below.
//
const STRUCT_C = 5;

const SIZES: [number, number, number][] = [
  [ 96, 24, 2],
  [ 64, 16, 1],
  [160, 32, 3],
  [200, 40, 4],
];

for (const [length, width, chokes] of SIZES) {
  test("levels " + length + "x" + width + " with " + chokes + " chokes", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const p: GenParams = { ...DEFAULTS, seed, length, width, chokes, C: STRUCT_C, pathRamps: false },
            lv = generate(p),
            g  = lv.grid,
            a  = lv.analysis;

      assert.ok(a.feasible, "seed " + seed + " infeasible");
      assert.ok(a.ratio >= p.minRatio);
      assert.equal(lv.routes.length, 2);

      // The cheapest track obeys the building rules, checked step by step
      // independently of the search.
      //
      assert.ok(!a.cheapest!.reusesColumn, "seed " + seed + ": track uses a column twice");
      const why = checkTrack(g, a.cheapest!.steps);
      assert.equal(why, null, "seed " + seed + ": " + why);

      // In each wall's first full column, the only non-black-rock cells
      // are the two gaps, whose widths match the routes' gap widths and
      // which are separated by black rock.
      //
      for (let i = 0; i < chokes; i++) {
        const x = lv.chokesX[i];
        const open = [] as number[];
        for (let y = 0; y < g.h; y++) {
          if (g.get(x, y) !== Cell.BLACKROCK) { open.push(y); }
        }
        const runs = [] as number[];
        for (let k = 0; k < open.length; k++) {
          if ( (k === 0) || (open[k] !== (open[k - 1] + 1)) ) { runs.push(1); }
          else                                                { runs[runs.length - 1]++; }
        }
        const want = [lv.routes[0].gaps[i], lv.routes[1].gaps[i]].sort((u, v) => u - v);
        assert.deepEqual(runs.slice().sort((u, v) => u - v), want,
                         "seed " + seed + " wall " + i + " gaps " + runs.join(","));
      }

      // Same seed, same level.
      //
      if (seed <= 20) {
        const again = generate(p);
        assert.deepEqual(Array.from(again.grid.cells), Array.from(g.cells));
      }

      // Round trip through the Tiled format.
      //
      if (seed <= 20) {
        const map  = JSON.parse(JSON.stringify(toTmj(g, [], "cells.tsj"))),
              ts   = JSON.parse(JSON.stringify(tilesetTsj("cells.png"))),
              back = fromTmj(map, ts);
        assert.deepEqual(Array.from(back.cells), Array.from(g.cells));
        assert.deepEqual(Array.from(back.height), Array.from(g.height));
        assert.deepEqual(Array.from(back.dir), Array.from(g.dir));
        const b = analyze(back, { C: p.C, bridgeTrees: p.bridgeTrees });
        assert.equal(b.trackNeeded, a.trackNeeded);
      }
    }
  });
}

test("fixed station rows are honoured", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const lv = generate({ ...DEFAULTS, seed, C: STRUCT_C, width: 24, startY: 5, endY: 17 });
    assert.ok(lv.analysis.stations.start.every(pt => (pt[1] === 5)));
    assert.ok(lv.analysis.stations.end.every(pt => (pt[1] === 17)));
  }
});

test("flat levels still work", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const lv = generate({ ...DEFAULTS, seed, C: STRUCT_C, levels: 1 });
    const g = lv.grid;
    assert.ok(g.height.every((z, i) => ( (z === 0) || (g.cells[i] === Cell.BLACKROCK) )),
              "only black rock mountains rise above level 0");
    assert.ok(lv.analysis.feasible);
  }
});

test("many height levels", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const lv = generate({ ...DEFAULTS, seed, C: STRUCT_C, levels: 6, hillScale: 16 });
    assert.ok(lv.analysis.feasible);
  }
});

// With the default parameters (including the default C), generation may
// occasionally give up, but rarely.
//
test("defaults rarely give up", () => {
  let gaveUp = 0;
  for (let seed = 1; seed <= 200; seed++) {
    try { generate({ ...DEFAULTS, seed }); }
    catch (e) {
      if (!String(e).includes("no valid level")) { throw e; }
      gaveUp++;
    }
  }
  assert.ok(gaveUp <= 4, "gave up on " + gaveUp + " of 200 seeds");
});

test("ramps included in the level", () => {
  for (let seed = 1; seed <= 100; seed++) {
    for (const opt of [ { rampChance: 0.08, pathRamps: false },
                        { rampChance: 0,    pathRamps: true  },
                        { rampChance: 0.08, pathRamps: true  } ]) {
      const lv = generate({ ...DEFAULTS, seed, ...opt }),
            a  = lv.analysis;
      const why = checkTrack(lv.grid, a.cheapest!.steps);
      assert.equal(why, null, "seed " + seed + " " + JSON.stringify(opt) + ": " + why);
      if (opt.pathRamps) {
        const left = a.cheapest!.steps.filter(p => ( (p.kind === "ramp") && !p.built && !p.bridge )).length;
        assert.equal(left, 0, "seed " + seed + ": track still needs " + left + " ramps");
      }

      // Same terrain as without included ramps, apart from ramp cells,
      // when both accepted the same attempt (building ramps can make an
      // attempt fail its re-check, moving on to a different terrain).
      //
      const b0 = generate({ ...DEFAULTS, seed, rampChance: 0, pathRamps: false });
      if (b0.attempt !== lv.attempt) { continue; }
      const base = b0.grid;
      for (let i = 0; i < base.cells.length; i++) {
        if (lv.grid.cells[i] === Cell.RAMP_GROUND) { continue; }
        assert.equal(lv.grid.cells[i], base.cells[i]);
        assert.equal(lv.grid.height[i], base.height[i]);
      }
    }
  }
});

test("no trees or grey rock on the two rows north of a station, where its building stands; they are level ground", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const g = generate({ ...DEFAULTS, seed, forestDensity: 40, rockDensity: 30 }).grid;
    for (let y = 1; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (g.get(x, y) !== Cell.STATION) { continue; }
        for (const dy of [1, 2]) {
          for (const dx of [-1, 0, 1]) {
            if (!g.inside(x + dx, y - dy)) { continue; }
            const c = g.get(x + dx, y - dy);
            assert.ok( (c !== Cell.TREE) && (c !== Cell.ROCK), "seed " + seed + ": resource at " + (x + dx) + "," + (y - dy) );
            assert.equal(g.z(x + dx, y - dy), g.z(x, y), "seed " + seed + ": level at " + (x + dx) + "," + (y - dy));
          }
        }
      }
    }
  }
});

test("water is held in on every side; station rings and the cells ahead of the start are plain ground", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = generate({ ...DEFAULTS, seed, pondDensity: 12, width: 24 }).grid;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (g.get(x, y) !== Cell.WATER) { continue; }
        for (const [dx, dy] of DIRS) {
          assert.ok( g.inside(x + dx, y + dy) && (g.z(x + dx, y + dy) >= g.z(x, y)),
                     "seed " + seed + ": water at " + x + "," + y + " open to the " + dx + "," + dy );
        }
      }
    }

    // Station runs, west to east; the first is the start.
    //
    const runs = [] as [number, number, number][];
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if ( (g.get(x, y) === Cell.STATION) && ( (x === 0) || (g.get(x - 1, y) !== Cell.STATION) ) ) {
          let n = 0;
          while ( ((x + n) < g.w) && (g.get(x + n, y) === Cell.STATION) ) { n++; }
          runs.push([x, y, n]);
        }
      }
    }
    runs.sort((a, b) => (a[0] - b[0]));
    assert.equal(runs.length, 2);
    runs.forEach(([px, py, n], k) => {
      const z = g.z(px, py), plain = (x: number, y: number) => ( !g.inside(x, y) || ( (g.get(x, y) === Cell.GROUND) && (g.z(x, y) === z) ) );
      for (let y = py - 1; y <= (py + 1); y++) {
        for (let x = px - 1; x <= (px + n); x++) {
          if ( (y === py) && (x >= px) && (x < (px + n)) ) { continue; }
          assert.ok(plain(x, y), "seed " + seed + ": station ring cell " + x + "," + y);
        }
      }
      if (k === 0) {
        for (let x = px + n; x < (px + n + 3); x++) { assert.ok( g.inside(x, py) && plain(x, py), "seed " + seed + ": ahead cell " + x ); }
      }
    });
  }
});

test("choke separation hint: exact when it fits, as far apart as possible for -1 or when too large", () => {
  const seps = (sep: number, seed: number, width: number) => {
    const lv = generate({ ...DEFAULTS, seed, width, chokeSeparation: sep, narrowGap: [2, 2], wideGap: [4, 4] }), g = lv.grid;
    return lv.chokesX.map(cx => {
      const open = [] as number[];
      for (let y = 0; y < g.h; y++) {
        const c = g.get(cx + 1, y);
        if ( (c !== Cell.BLACKROCK) && (c !== Cell.RAMP_BLACKROCK) ) { open.push(y); }
      }
      const runs = [] as number[][];
      for (const y of open) {
        if ( runs.length && (runs.at(-1)!.at(-1)! === (y - 1)) ) { runs.at(-1)!.push(y); } else { runs.push([y]); }
      }
      assert.equal(runs.length, 2, "two gaps: " + JSON.stringify(runs));
      return runs[1][0] - runs[0].at(-1)! - 1;
    });
  };
  for (let seed = 1; seed <= 10; seed++) {
    assert.ok(seps(5, seed, 20).every(s => (s === 5)), "seed " + seed + ": hint 5 met");
    assert.ok(seps(-1, seed, 20).every(s => (s === (20 - 2 - 4))), "seed " + seed + ": -1 uses the whole width");
    assert.ok(seps(50, seed, 20).every(s => (s === (20 - 2 - 4))), "seed " + seed + ": too large gives the most");
    assert.ok(seps(0, seed, 20).every(s => (s >= 2)), "seed " + seed + ": no hint keeps at least 2");
  }
});
