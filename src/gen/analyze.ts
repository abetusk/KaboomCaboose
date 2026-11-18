// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Level checks: the cheapest track the players could build from the start
// station to the end station, and the resources avatars can reach.
//
// Building rules (docs/DESIGN.md D4.6-D4.14):
// - Track is one piece per cell.
// - Over water, or over ground lower than the track, the track runs on a
//   bridge: `bridgeTrees` trees per cell, on top of the track piece.
// - Track changes level only on a ramp, built from one grey rock. A ramp
//   sits on ground, rock, black rock or bridge, abuts a sheer face exactly
//   one level up, and the track runs straight along it: low end, ramp,
//   high end, in a line.
// - Black rock tops are walkable and can carry track.
//

import { Cell, Grid, DIRS, isRamp } from "../level/cells.ts";

export type Pt = [number, number];

export interface Stations {
  start : Pt[];
  end   : Pt[];
}

// One cell of the cheapest track. `z` is the height the track runs at.
// `kind`:
//   station : a station cell
//   land    : track on the cell's own surface
//   bridge  : track on a bridge (over water, or over lower ground)
//   ramp    : a ramp, `dir` pointing uphill; `bridge` true if the ramp
//             stands on a bridge
//
export interface Step {
  x      : number;
  y      : number;
  z      : number;
  kind   : "station" | "land" | "bridge" | "ramp";
  dir    : number;
  bridge : boolean;
  built  : boolean;
}

export interface PathInfo {
  steps   : Step[];
  cells   : Pt[];
  track   : number;
  bridges : number;
  ramps   : number;

  // The search works on (cell, height) and does not stop a track from
  // using one column twice (for example a bridge over a ramp the same
  // track runs on), which cannot be built. True if that happened.
  //
  reusesColumn : boolean;
}

export interface Analysis {
  stations   : Stations;
  cheapest   : PathInfo | null;
  reachTrees : number;
  reachRock  : number;

  // Track pieces the cheapest path needs, the resources that requires,
  // and whether the level's reachable resources cover it.
  //
  trackNeeded : number;
  treesNeeded : number;
  rockNeeded  : number;
  feasible    : boolean;

  // min(T - bridge trees, R - ramp rock) * C / track. At least 1 when
  // feasible.
  //
  ratio : number;
}

export interface Rules {
  C           : number;
  bridgeTrees : number;
}

const N4: Pt[] = [[1,0], [-1,0], [0,1], [0,-1]];

// Station cells form two clusters. The cluster with the smallest x is the
// start station, the one with the largest x the end station.
//
export function findStations(g: Grid): Stations {
  const all = stationClusters(g);
  return { start: all[0], end: all[all.length - 1] };
}

// Every station cluster, west to east (a run of levels has one more
// station than levels, D6.4).
//
export function stationClusters(g: Grid): Pt[][] {
  const seen     = new Uint8Array(g.w * g.h),
        clusters = [] as Pt[][];

  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if ( (g.get(x, y) !== Cell.STATION) || seen[(y * g.w) + x] ) { continue; }
      const c = [] as Pt[], st: Pt[] = [[x, y]];
      seen[(y * g.w) + x] = 1;
      while (st.length) {
        const [px, py] = st.pop()!;
        c.push([px, py]);
        for (const [dx, dy] of N4) {
          const nx = px + dx, ny = py + dy;
          if ( g.inside(nx, ny) &&
               (g.get(nx, ny) === Cell.STATION) &&
               !seen[(ny * g.w) + nx] ) {
            seen[(ny * g.w) + nx] = 1;
            st.push([nx, ny]);
          }
        }
      }
      clusters.push(c);
    }
  }

  if (clusters.length < 2) { throw new Error("level needs two station clusters, found " + clusters.length); }

  const minx = (c: Pt[]) => Math.min(...c.map(p => p[0]));
  clusters.sort((a, b) => minx(a) - minx(b));
  return clusters;
}

// Surfaces a ramp can stand on, and a ramp's high end can abut.
//
function solid(c: number): boolean {
  return ( (c === Cell.GROUND) || (c === Cell.ROCK) || (c === Cell.BLACKROCK) || (c === Cell.TREE) );
}

// Track cost, in track-piece units, to put track on cell i at height z
// without a level change, or Infinity. Bridges cost bridgeTrees trees,
// counted as C track pieces each so one scalar can be minimised.
//
function enterCost(g: Grid, i: number, z: number, r: Rules): { cost: number, kind: "station" | "land" | "bridge" } | null {
  const c = g.cells[i], h = g.height[i];
  if (c === Cell.AIR) { return null; }
  if (h > z) { return null; }
  if (h === z) {
    if (c === Cell.STATION) { return { cost: 0, kind: "station" }; }
    if (c === Cell.WATER)   { return { cost: 1 + (r.bridgeTrees * r.C), kind: "bridge" }; }
    if (isRamp(c))          { return null; }
    return { cost: 1, kind: "land" };
  }
  if (c === Cell.STATION) { return null; }
  return { cost: 1 + (r.bridgeTrees * r.C), kind: "bridge" };
}

// Small extra cost on ramps still to build, so that between equally
// cheap tracks the search prefers ramps already in the level.
//
const TIE = 1e-6;

// Cost to put a ramp on cell i whose low end is at height z, pointing in
// direction d, or null. A ramp stands on a solid surface at z, or on a
// bridge at z. An existing ramp already pointing in d costs no rock.
//
function rampCost(g: Grid, i: number, z: number, d: number, r: Rules): { cost: number, bridge: boolean, built: boolean } | null {
  const c = g.cells[i], h = g.height[i];
  if (h === z) {
    if ( isRamp(c) && (g.dir[i] === d) ) { return { cost: 1, bridge: false, built: true }; }
    if (solid(c))                        { return { cost: 1 + r.C + TIE, bridge: false, built: false }; }
    return null;
  }
  if ( (h < z) && (c !== Cell.STATION) && (c !== Cell.AIR) ) {
    return { cost: 1 + r.C + (r.bridgeTrees * r.C) + TIE, bridge: true, built: false };
  }
  return null;
}

// Dijkstra over (cell, track height) from the start station to the end
// station.
//
export function cheapestPath(g: Grid, st: Stations, r: Rules): PathInfo | null {
  let top = 0;
  for (let i = 0; i < g.height.length; i++) { top = Math.max(top, g.height[i]); }
  const NZ = top + 2,
        n  = g.w * g.h * NZ,
        S  = (i: number, z: number) => ( (i * NZ) + z );

  const dist = new Float64Array(n).fill(Infinity),
        prev = new Int32Array(n).fill(-1),
        how  = new Array<Step[] | undefined>(n),
        isEnd = new Uint8Array(g.w * g.h);
  for (const [x, y] of st.end) { isEnd[(y * g.w) + x] = 1; }

  const heap: [number, number][] = [];
  const push = (d: number, s: number) => {
    heap.push([d, s]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) { break; }
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const t = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const a = (2 * k) + 1, b = a + 1;
        let m = k;
        if ( (a < heap.length) && (heap[a][0] < heap[m][0]) ) { m = a; }
        if ( (b < heap.length) && (heap[b][0] < heap[m][0]) ) { m = b; }
        if (m === k) { break; }
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return t;
  };
  const relax = (from: number, to: number, d: number, steps: Step[]) => {
    if (d < dist[to]) {
      dist[to] = d;
      prev[to] = from;
      how[to]  = steps;
      push(d, to);
    }
  };

  for (const [x, y] of st.start) {
    const i = (y * g.w) + x, s = S(i, g.height[i]);
    dist[s] = 0;
    how[s]  = [{ x, y, z: g.height[i], kind: "station", dir: -1, bridge: false, built: true }];
    push(0, s);
  }

  let goal = -1;
  while (heap.length) {
    const [d, s] = pop();
    if (d > dist[s]) { continue; }
    const i = Math.floor(s / NZ), z = s % NZ,
          x = i % g.w,            y = (i / g.w) | 0;
    if ( isEnd[i] && (g.height[i] === z) ) { goal = s; break; }

    for (let k = 0; k < 4; k++) {
      const [dx, dy] = DIRS[k],
            ax = x + dx,      ay = y + dy;
      if (!g.inside(ax, ay)) { continue; }
      const a = (ay * g.w) + ax;

      // Same level: land or bridge.
      //
      const e = enterCost(g, a, z, r);
      if (e) {
        relax(s, S(a, z), d + e.cost,
              [{ x: ax, y: ay, z, kind: e.kind, dir: -1, bridge: (e.kind === "bridge"), built: false }]);
      }

      const bx = ax + dx, by = ay + dy;
      if (!g.inside(bx, by)) { continue; }
      const b = (by * g.w) + bx;

      // Up: ramp on a (low end at z), high end b on solid ground at z + 1.
      //
      if ( (z + 1) < NZ ) {
        const rc = rampCost(g, a, z, k, r);
        if ( rc && (g.height[b] === (z + 1)) && solid(g.cells[b]) ) {
          relax(s, S(b, z + 1), d + rc.cost + 1,
                [{ x: ax, y: ay, z, kind: "ramp", dir: k, bridge: rc.bridge, built: rc.built },
                 { x: bx, y: by, z: z + 1, kind: "land", dir: -1, bridge: false, built: false }]);
        }
      }

      // Down: the current cell is the high end at z (solid ground, or a
      // bridge); ramp on a with its low end at z - 1, pointing back toward
      // us; then on to b at z - 1.
      //
      const highOk = ( ( (g.height[i] === z) && solid(g.cells[i]) ) ||
                       ( (g.height[i] < z) && (g.cells[i] !== Cell.STATION) ) );
      if ( (z >= 1) && highOk ) {
        const back = (k + 2) % 4,
              rc   = rampCost(g, a, z - 1, back, r),
              eb   = enterCost(g, b, z - 1, r);
        if ( rc && eb ) {
          relax(s, S(b, z - 1), d + rc.cost + eb.cost,
                [{ x: ax, y: ay, z: z - 1, kind: "ramp", dir: back, bridge: rc.bridge, built: rc.built },
                 { x: bx, y: by, z: z - 1, kind: eb.kind, dir: -1, bridge: (eb.kind === "bridge"), built: false }]);
        }
      }
    }
  }
  if (goal < 0) { return null; }

  const steps = [] as Step[];
  for (let s = goal; s >= 0; s = prev[s]) {
    const h = how[s]!;
    for (let k = h.length - 1; k >= 0; k--) { steps.push(h[k]); }
  }
  steps.reverse();

  let track = 0, bridges = 0, ramps = 0;
  for (const p of steps) {
    if (p.kind === "station") { continue; }
    track++;
    if ( (p.kind === "bridge") || p.bridge )   { bridges++; }
    if ( (p.kind === "ramp") && !p.built )     { ramps++; }
  }
  const cols = new Set<number>();
  let reusesColumn = false;
  for (const p of steps) {
    const c = (p.y * g.w) + p.x;
    if (cols.has(c)) { reusesColumn = true; }
    cols.add(c);
  }
  return { steps, cells: steps.map(p => [p.x, p.y] as Pt), track, bridges, ramps, reusesColumn };
}

// Whether an avatar can move from cell i to its neighbour j. Avatars walk
// on equal heights, drop one level with a boost, and climb one level with
// a ramp they can build (the higher cell must be solid). Water blocks
// (bridges are not counted). Drops of two or more levels kill.
//
function avatarStep(g: Grid, i: number, j: number): boolean {
  const cj = g.cells[j], dz = g.height[j] - g.height[i];
  if ( (cj === Cell.WATER) || (cj === Cell.AIR) ) { return false; }
  if (dz === 0)  { return true; }
  if (dz === -1) { return true; }
  if (dz === 1)  { return ( solid(cj) && (g.cells[i] !== Cell.WATER) ) || isRamp(g.cells[i]); }
  return false;
}

// Flood fill from the start station over cells avatars can reach.
//
export function reachable(g: Grid, st: Stations): Uint8Array {
  const seen = new Uint8Array(g.w * g.h),
        q    = [] as number[];
  for (const [x, y] of st.start) {
    seen[(y * g.w) + x] = 1;
    q.push((y * g.w) + x);
  }
  while (q.length) {
    const i = q.pop()!, x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!g.inside(nx, ny)) { continue; }
      const j = (ny * g.w) + nx;
      if ( seen[j] || !avatarStep(g, i, j) ) { continue; }
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

// Resources a track of n pieces with `bridges` bridge cells and `ramps`
// new ramps needs, and whether T trees and R rock cover it.
//
export function resourceCheck(n: number, bridges: number, ramps: number, T: number, R: number, r: Rules) {
  const per         = Math.ceil(n / r.C),
        bridgeTrees = bridges * r.bridgeTrees,
        treesNeeded = per + bridgeTrees,
        rockNeeded  = per + ramps,
        feasible    = ( (T >= treesNeeded) && (R >= rockNeeded) ),
        ratio       = ( (n > 0) ? ((Math.min(T - bridgeTrees, R - ramps) * r.C) / n) : Infinity );
  return { treesNeeded, rockNeeded, feasible, ratio };
}

export function analyze(g: Grid, r: Rules): Analysis {
  const stations = findStations(g),
        cheapest = cheapestPath(g, stations, r),
        reach    = reachable(g, stations);

  let T = 0, R = 0;
  for (let i = 0; i < reach.length; i++) {
    if (!reach[i]) { continue; }
    if      (g.cells[i] === Cell.TREE) { T++; }
    else if (g.cells[i] === Cell.ROCK) { R++; }
  }

  if (!cheapest) {
    return { stations, cheapest, reachTrees: T, reachRock: R,
             trackNeeded: Infinity, treesNeeded: Infinity, rockNeeded: Infinity,
             feasible: false, ratio: 0 };
  }

  const rc = resourceCheck(cheapest.track, cheapest.bridges, cheapest.ramps, T, R, r);
  return { stations, cheapest, reachTrees: T, reachRock: R, trackNeeded: cheapest.track, ...rc };
}
