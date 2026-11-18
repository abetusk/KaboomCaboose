// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The level as the simulation sees it: per-cell terrain, stacks, block
// damage and track. Runs the same in the server and the browser.
//
// Heights: a cell of height h is a column of blocks 0..h; characters and
// track stand on its top, at level h. Forest and grey rock cells are a
// block standing on level h that blocks walking until it is extracted
// (D6a.8), which turns the cell into ground. Water blocks unless bridged.
// A bridge deck is walkable at the level of the ledge it was built from
// (D4.8), stored as the cell's height; `under` keeps the height of the
// ground below it.
//

import { Cell, Grid, DIRS, isRamp, type CellType } from "../level/cells.ts";
import { stationClusters } from "../gen/analyze.ts";

export type Pt = [number, number];

// What a stack or a hand holds (D6a.1).
//
// DYNAMITE is a stick from the dynamite wagon (D6.12), carried one at a
// time and never put down unlit.
//
export const Item = { NONE: 0, WOOD: 1, ORE: 2, TRACK: 3, WAGON_STORAGE: 4, WAGON_CRAFTING: 5, WAGON_DYNAMITE: 6, DYNAMITE: 7 } as const;
export type ItemKind = (typeof Item)[keyof typeof Item];
export const ITEM_NAMES = ["none", "wood", "ore", "track", "storage wagon", "crafting wagon", "dynamite wagon", "dynamite"];

// Cells of track behind the start station the train's line takes in
// (World.line): enough for the longest train (MAX_CARS cars of 2 cells)
// less the station (6 cells), and a little more.
//
export const LINE_BACK = 10;

// Wagons won at stations (D6.7) lie on the ground and are carried one at
// a time, as items; this maps a wagon kind (a car of the train) to its
// item and back.
//
export const WAGON_ITEMS: Record<string, ItemKind> = { storage: Item.WAGON_STORAGE, crafting: Item.WAGON_CRAFTING, dynamite: Item.WAGON_DYNAMITE };

export function wagonOf(item: number): string | null {
  for (const [kind, it] of Object.entries(WAGON_ITEMS)) {
    if (it === item) { return kind; }
  }
  return null;
}

export const opposite = (d: number) => ((d + 2) % 4);

// The plain level a client needs to rebuild the world, sent on connect.
//
export interface LevelData {
  w      : number;
  h      : number;
  cells  : number[];
  height : number[];
  dir    : number[];
}

// One cell's changeable state, sent whenever it changes.
//
export interface CellState {
  i      : number;
  type   : number;
  height : number;
  dir    : number;
  bridge : number;
  under  : number;
  stack  : number;
  count  : number;
  hits   : number;
  conn   : number;
  track  : number;
}

export class World {
  g       : Grid;
  bridge  : Uint8Array;
  under   : Int8Array;
  stack   : Uint8Array;
  count   : Uint16Array;
  hits    : Uint8Array;
  track   : Uint8Array;
  conn    : Uint8Array;
  start   : Pt[];
  end     : Pt[];
  changed : Set<number>;

  // Every station west to east, each sorted west to east. A run of
  // levels (D6.4) is one world with a station between each two levels;
  // `seg` is the level being played (0 first), whose stretch runs from
  // stations[seg] (start) to stations[seg + 1] (end).
  //
  stations : Pt[][];
  seg      : number;

  constructor(g: Grid) {
    const n = g.w * g.h;
    this.g       = g;
    this.bridge  = new Uint8Array(n);
    this.under   = new Int8Array(g.height);
    this.stack   = new Uint8Array(n);
    this.count   = new Uint16Array(n);
    this.hits    = new Uint8Array(n);
    this.track   = new Uint8Array(n);
    this.conn    = new Uint8Array(n);
    this.changed = new Set();
    const all = stationClusters(g);
    if (all.length < 2) { throw new Error("level needs at least two stations, found " + all.length); }
    this.stations = all.map(c => c.slice().sort((a, b) => (a[0] - b[0])));
    this.seg      = 0;
    this.start    = this.stations[0];
    this.end      = this.stations[1];

    // Station cells carry track, joined east-west along the station
    // (stations lie along x).
    //
    for (const cells of this.stations) {
      cells.forEach(([x, y], k) => {
        const i = this.idx(x, y);
        this.track[i] = 1;
        if (k > 0)                  { this.conn[i] |= (1 << 3); }
        if (k < (cells.length - 1)) { this.conn[i] |= (1 << 1); }
      });
    }
  }

  // Levels in this world (one less than stations).
  //
  get segments(): number { return ( this.stations.length - 1 ); }

  // Play level k: its start and end stations.
  //
  setSegment(k: number): void {
    this.seg   = Math.max(0, Math.min(this.segments - 1, k));
    this.start = this.stations[this.seg];
    this.end   = this.stations[this.seg + 1];
  }

  static fromData(d: LevelData): World {
    const g = new Grid(d.w, d.h, Cell.GROUND);
    g.cells.set(d.cells); g.height.set(d.height); g.dir.set(d.dir);
    return new World(g);
  }

  toData(): LevelData {
    return { w: this.g.w, h: this.g.h, cells: [...this.g.cells], height: [...this.g.height], dir: [...this.g.dir] };
  }

  get w(): number { return this.g.w; }
  get h(): number { return this.g.h; }

  idx(x: number, y: number): number { return ( (y * this.g.w) + x ); }
  xy(i: number): Pt { return [i % this.g.w, Math.floor(i / this.g.w)]; }
  inside(x: number, y: number): boolean { return this.g.inside(x, y); }
  type(i: number): CellType { return this.g.cells[i] as CellType; }
  z(i: number): number { return this.g.height[i]; }

  // Neighbour of cell i in direction d, or -1 off the map.
  //
  step(i: number, d: number): number {
    const [x, y] = this.xy(i), nx = x + DIRS[d][0], ny = y + DIRS[d][1];
    return ( this.inside(nx, ny) ? this.idx(nx, ny) : -1 );
  }

  // Direction from cell i to its neighbour j, or -1.
  //
  dirTo(i: number, j: number): number {
    for (let d = 0; d < 4; d++) { if (this.step(i, d) === j) { return d; } }
    return -1;
  }

  // Whether characters can stand on cell i.
  //
  walkable(i: number): boolean {
    const c = this.type(i);
    if (c === Cell.WATER) { return (this.bridge[i] === 1); }
    return ( (c !== Cell.AIR) && (c !== Cell.TREE) && (c !== Cell.ROCK) );
  }

  // Whether characters can stand on cell i: walkable cells, and the top
  // of grey rock (D4.15), which is not walkable for building.
  //
  standable(i: number): boolean { return ( this.walkable(i) || (this.type(i) === Cell.ROCK) ); }

  // Height a character stands at on cell i: the cell's level, one more
  // on top of grey rock (D4.15).
  //
  standZ(i: number): number { return ( this.g.height[i] + ( (this.type(i) === Cell.ROCK) ? 1 : 0 ) ); }

  // Whether a solid top is there for a ramp to lean on (D4.7).
  //
  solidTop(i: number): boolean {
    const c = this.type(i);
    return ( ( (c !== Cell.WATER) || (this.bridge[i] === 1) ) && (c !== Cell.AIR) && !isRamp(c) );
  }

  // Height rule for walking or track between neighbours i and j (D4.6,
  // D4.14): equal height, or along a ramp's uphill direction to a cell one
  // level up. Heights are standing heights, so grey rock counts one level
  // up (D4.15).
  //
  joins(i: number, j: number): boolean {
    const d = this.dirTo(i, j);
    if (d < 0) { return false; }
    const zi = this.standZ(i), zj = this.standZ(j);
    if ( isRamp(this.type(i)) && (this.g.dir[i] === d) )           { return (zj === (zi + 1)); }
    if ( isRamp(this.type(j)) && (this.g.dir[j] === opposite(d)) ) { return (zi === (zj + 1)); }
    return (zi === zj);
  }

  // Whether a character in cell `from` may enter cell `to`.
  //
  enterable(from: number, to: number, boosting: boolean): boolean {
    if ( (to < 0) || !this.standable(to) ) { return false; }
    if (from === to) { return true; }
    if (this.joins(from, to)) { return true; }

    // Boosting carries a character over a guard rail to any lower cell
    // (D4.9); the fall is judged on landing.
    //
    return ( boosting && (this.standZ(to) < this.standZ(from)) && !isRamp(this.type(to)) );
  }

  // Whether cell j blocks a character standing in cell `from`. A
  // diagonal neighbour blocks only if neither of the two cells between
  // them leads into it, so characters slide past open corners.
  //
  blocks(from: number, j: number, boosting: boolean): boolean {
    if (j < 0) { return true; }
    if (j === from) { return false; }
    const [fx, fy] = this.xy(from), [jx, jy] = this.xy(j);
    if ( (Math.abs(jx - fx) + Math.abs(jy - fy)) === 1 ) { return !this.enterable(from, j, boosting); }
    if ( (Math.abs(jx - fx) > 1) || (Math.abs(jy - fy) > 1) ) { return false; }
    const a = this.idx(jx, fy), b = this.idx(fx, jy);
    return !( ( this.enterable(from, a, boosting) && this.enterable(a, j, boosting) ) ||
              ( this.enterable(from, b, boosting) && this.enterable(b, j, boosting) ) );
  }

  // Track joins are stricter on ramps: only along the ramp (D4.14).
  //
  trackJoins(i: number, j: number): boolean {
    const d = this.dirTo(i, j);
    if ( (d < 0) || !this.joins(i, j) ) { return false; }
    for (const [k, dk] of [[i, d], [j, opposite(d)]] as [number, number][]) {
      if ( isRamp(this.type(k)) && ((this.g.dir[k] % 2) !== (dk % 2)) ) { return false; }
    }
    return true;
  }

  // Whether a new track piece may go on cell i (D4.2, D4.12).
  //
  trackAllowed(i: number): boolean {
    const c = this.type(i);
    return ( this.walkable(i) && !this.track[i] && !this.stack[i] && (c !== Cell.STATION) );
  }

  countTrackConn(i: number): number {
    let n = 0;
    for (let d = 0; d < 4; d++) { if (this.conn[i] & (1 << d)) { n++; } }
    return n;
  }

  touch(i: number): void { this.changed.add(i); }

  cellState(i: number): CellState {
    return {
      i, type: this.type(i), height: this.z(i), dir: this.g.dir[i], bridge: this.bridge[i], under: this.under[i],
      stack: this.stack[i], count: this.count[i], hits: this.hits[i], conn: this.conn[i], track: this.track[i],
    };
  }

  // Whether cell i holds the same here as in o, a world of the same
  // level.
  //
  sameCell(o: World, i: number): boolean {
    return ( (this.g.cells[i] === o.g.cells[i]) && (this.g.height[i] === o.g.height[i]) && (this.g.dir[i] === o.g.dir[i]) &&
             (this.bridge[i] === o.bridge[i]) && (this.under[i] === o.under[i]) && (this.stack[i] === o.stack[i]) &&
             (this.count[i] === o.count[i]) && (this.hits[i] === o.hits[i]) && (this.conn[i] === o.conn[i]) &&
             (this.track[i] === o.track[i]) );
  }

  copyCell(o: World, i: number): void {
    this.g.cells[i] = o.g.cells[i]; this.g.height[i] = o.g.height[i]; this.g.dir[i] = o.g.dir[i];
    this.bridge[i] = o.bridge[i]; this.under[i] = o.under[i]; this.stack[i] = o.stack[i]; this.count[i] = o.count[i];
    this.hits[i] = o.hits[i]; this.conn[i] = o.conn[i]; this.track[i] = o.track[i];
  }

  // Make every cell as in o (a world of the same level), noting each
  // one that changes.
  //
  copyFrom(o: World): void {
    for (let i = 0; i < (this.w * this.h); i++) {
      if (!this.sameCell(o, i)) { this.copyCell(o, i); this.touch(i); }
    }
  }

  applyCell(s: CellState): void {
    const i = s.i;
    this.g.cells[i] = s.type; this.g.height[i] = s.height; this.g.dir[i] = s.dir;
    this.bridge[i] = s.bridge; this.under[i] = s.under; this.stack[i] = s.stack; this.count[i] = s.count;
    this.hits[i] = s.hits; this.conn[i] = s.conn; this.track[i] = s.track;
  }

  // Directions a new piece on cell i would join (D6a.9, D6a.10): at most
  // two neighbours that can take one more joint, the open end of the
  // train's line (`lineEnd`) first, then straight through over a curve,
  // then north, east, south, west. Existing joints are never broken.
  //
  joinDirs(i: number, lineEnd: number): number[] {
    const cands = [] as number[], start = this.idx(this.start[0][0], this.start[0][1]);
    for (let d = 0; d < 4; d++) {
      const j = this.step(i, d);
      if ( (j < 0) || !this.track[j] || (this.countTrackConn(j) >= 2) || !this.trackJoins(i, j) ) { continue; }

      // The line starts at the west end of the start station; nothing
      // joins it from behind.
      //
      if (j === start) { continue; }
      cands.push(d);
    }
    if (!cands.length) { return []; }
    const endDir = cands.find(d => (this.step(i, d) === lineEnd)),
          first  = ( (endDir !== undefined) ? endDir : cands[0] ),
          rest   = cands.filter(d => (d !== first)),
          second = ( rest.includes(opposite(first)) ? opposite(first) : rest[0] );
    return ( (second === undefined) ? [first] : [first, second] );
  }

  // Lay a track piece on cell i and join it to its neighbours. Returns
  // false if track is not allowed there.
  //
  layTrack(i: number, lineEnd: number): boolean {
    if (!this.trackAllowed(i)) { return false; }
    const dirs = this.joinDirs(i, lineEnd);
    this.track[i] = 1;
    this.conn[i]  = 0;
    this.touch(i);
    for (const d of dirs) {
      const j = this.step(i, d);
      this.conn[i] |= (1 << d);
      this.conn[j] |= (1 << opposite(d));
      this.touch(j);
    }
    return true;
  }

  // Remove the track piece on cell i, cutting its joints.
  //
  liftTrack(i: number): void {
    for (let d = 0; d < 4; d++) {
      if (!(this.conn[i] & (1 << d))) { continue; }
      const j = this.step(i, d);
      this.conn[j] &= ~(1 << opposite(d));
      this.touch(j);
    }
    this.track[i] = 0;
    this.conn[i]  = 0;
    this.touch(i);
  }

  // The train's line: from the west end of the start station, east along
  // the station, then follow joints until they stop. In a run, the track
  // of the level before also joins the start station's west end: up to
  // LINE_BACK cells of it come first, so a train longer than the station
  // (wagons added at stations, D6.7) still stands on track. lineBack()
  // says how many came first.
  //
  line(): number[] {
    const s0 = this.idx(this.start[0][0], this.start[0][1]),
          s1 = ( (this.start.length > 1) ? this.idx(this.start[1][0], this.start[1][1]) : -1 );
    const out = [] as number[], seen = new Set<number>([s0]);
    let prev = s1, cur = s0;
    for (let k = 0; k < LINE_BACK; k++) {
      let next = -1;
      for (let d = 0; ( (d < 4) && (next < 0) ); d++) {
        if (!(this.conn[cur] & (1 << d))) { continue; }
        const j = this.step(cur, d);
        if ( (j !== prev) && !seen.has(j) ) { next = j; }
      }
      if (next < 0) { break; }
      out.unshift(next);
      seen.add(next);
      prev = cur;
      cur  = next;
    }
    seen.clear();
    for (const i of out) { seen.add(i); }
    prev = -1; cur = s0;
    while ( (cur >= 0) && !seen.has(cur) ) {
      out.push(cur);
      seen.add(cur);
      let next = -1;
      if ( (cur === s0) && (s1 >= 0) ) { next = s1; }
      for (let d = 0; ( (d < 4) && (next < 0) ); d++) {
        if (!(this.conn[cur] & (1 << d))) { continue; }
        const j = this.step(cur, d);
        if (j !== prev) { next = j; }
      }
      prev = cur;
      cur  = next;
    }
    return out;
  }

  // How many cells of the line come before the start station's west end.
  //
  lineBack(line: number[]): number {
    return Math.max(0, line.indexOf(this.idx(this.start[0][0], this.start[0][1])));
  }

  // Forest and grey rock cells in columns x0 to x1 (default: all), for
  // the level timer (D6a.3).
  //
  resourceCounts(x0 = 0, x1 = this.w - 1): { T: number, R: number } {
    let T = 0, R = 0;
    for (let y = 0; y < this.h; y++) {
      for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) {
        const c = this.g.cells[(y * this.w) + x];
        if      (c === Cell.TREE) { T++; }
        else if (c === Cell.ROCK) { R++; }
      }
    }
    return { T, R };
  }
}
