// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The rules simulation (docs/DESIGN.md section 6a): characters, the
// train, crafting, chopping and mining, stacks and track. Advanced in
// fixed ticks by the server; deterministic for a given seed and inputs.
//

import { Cell, DIRS, isRamp, LEVEL_Y } from "../level/cells.ts";
import { World, Item, opposite, wagonOf, WAGON_ITEMS, type ItemKind } from "./world.ts";
import { carPose } from "./path.ts";
import { Rng } from "../gen/rng.ts";
import { UPGRADES, OFFERS_PER_STATION, upgrade } from "../upgrades.ts";
import { launch, stepBomb, floorAt, type Bomb } from "./dynamite.ts";
import type { Rules, TrainConfig, AvatarConfig, StationConfig } from "../config.ts";

export interface Settings {
  rules   : Rules;
  train   : TrainConfig;
  avatar  : AvatarConfig;
  station : StationConfig;
  tickHz  : number;
}

// The start pad (D6.9): a shadow circle beside the start station. Players
// standing in it for the dwell time start the countdown to departure.
//
export interface Pad {
  x        : number;
  y        : number;
  progress : number;
}

export const PAD_RADIUS = 0.6;

// A press with a lit stick shorter than this many seconds puts it down
// instead of throwing it (D6.12).
//
export const TAP = 0.25;

// An upgrade on offer at a station (D6.7): a circle like the start pad,
// picked by standing in it for station.dwellSeconds.
//
export interface Offer {
  kind     : string;
  x        : number;
  y        : number;
  progress : number;
}

// What a character holds in its hands besides carried items (D6a.20):
// the pickaxe mines grey rock, the axe chops trees, and only with no
// tool can a character pick up, place or drop anything. TOOL_ORDER is
// the order the next/previous-tool keys step through.
//
export const Tool = { NONE: 0, PICK: 1, AXE: 2 } as const;
export const TOOL_ORDER = [Tool.PICK, Tool.AXE, Tool.NONE];
export const TOOL_NAMES = ["no tool", "pickaxe", "axe"];
export const TOOL_NEXT = 3, TOOL_PREV = 4;

// One player's controls for one tick. Move is a stick or key vector;
// `action` and `fast` (fast-forward) are held, `boost` is pressed this
// tick. `tool` is -1 for no
// change, a Tool value to take that tool, or TOOL_NEXT / TOOL_PREV.
//
export interface Input {
  mx     : number;
  my     : number;
  action : boolean;
  boost  : boolean;
  emote  : number;
  tool   : number;
  fast?  : boolean;

  // A tick with no input from the player's client (D7.4): the player
  // does nothing (no move, no press or hold; boost and hit timers
  // paused), so the client's own replay of its inputs stays exact. Only
  // the death, emote and refusal timers run.
  //
  idle?  : boolean;
}

export const NO_INPUT: Input = { mx: 0, my: 0, action: false, boost: false, emote: -1, tool: -1, fast: false };

export interface Player {
  id         : number;
  name       : string;
  character  : string;
  x          : number;
  y          : number;
  level      : number;
  facing     : number;

  // Direction of travel in radians (atan2 of the move, level axes: x
  // east, y south): the last walk direction, any angle (D2.9). Facing
  // stays one of four for target cells.
  //
  heading    : number;
  carry      : ItemKind;
  count      : number;
  hitT       : number;
  hitting    : boolean;
  boostT     : number;
  boostCd    : number;
  dead       : number;
  emote      : number;
  emoteT     : number;
  lastAction : boolean;
  lastCell   : number;
  wedgeT     : number;
  tool       : number;
  denyT      : number;

  // A dynamite stick in hand (D6.12): seconds left on its fuse (-1
  // unlit), and how long the action has been held to aim a throw (-1 not
  // aiming).
  //
  fuse       : number;
  aimT       : number;
}

// Train cars, front to back (D6a.13), as a train starts. Each is CAR_LEN
// cells long. Wagons won at stations join at the back (D6.7), up to
// MAX_CARS cars in all; each storage wagon holds rules.storageMax more of
// each resource, and each crafting wagon rules.trackMax more track and
// makes a pair at the same time as the others.
//
export const CARS     = ["locomotive", "storage", "crafting"] as const;
export const CAR_LEN  = 2;
export const MAX_CARS = 7;

// For collisions each car is a row of circles along its body, every
// CAR_STEP cells, covering CAR_BODY cells (a little less than the CAR_LEN
// it takes on the track; the models, at view.trainScale 1.1, are 1.86 and
// 1.79 cells long). The body rests on its wheels, a quarter of the body
// in from each end (WHEELBASE apart, carPose), so on a bend the circles
// cut across the inside of the curve as the body does. The circles'
// radius is train.collideRadius (D6a.16, D6a.26).
//
export const CAR_STEP  = 0.25;
export const CAR_BODY  = 1.85;
export const WHEELBASE = CAR_BODY / 2;

// The train's collision circles for a train whose front is at p and
// circles of radius r: points in the level, with the car's heading.
//
export function trainBody(w: World, line: number[], p: number, r: number, cars: number = CARS.length): { x: number, y: number, z: number, heading: number }[] {
  const out = [] as { x: number, y: number, z: number, heading: number }[], half = Math.max(0, (CAR_BODY / 2) - r);
  for (let c = 0; c < cars; c++) {
    const cp = carPose(w, line, p - (c * CAR_LEN) - (CAR_LEN / 2), WHEELBASE),
          ux = Math.cos(cp.heading), uy = Math.sin(cp.heading), span = Math.max(1e-6, WHEELBASE);
    for (let s = -half; s <= (half + 1e-9); s += CAR_STEP) {
      const t = (s / span) + 0.5;
      out.push({ x: cp.x + (ux * s), y: cp.y + (uy * s), z: cp.rear.z + ((cp.front.z - cp.rear.z) * Math.max(0, Math.min(1, t))), heading: cp.heading });
    }
  }
  return out;
}

// Distance from (x, y) to the nearest point of the cell (cx, cy), 0
// inside it.
//
export function cellEdgeDist(x: number, y: number, cx: number, cy: number): number {
  return Math.hypot(x - Math.max(cx, Math.min(cx + 1, x)), y - Math.max(cy, Math.min(cy + 1, y)));
}

// What one press of the action button would build, for the press itself
// and for the client's ghost preview.
//
export interface Plan {
  kind  : "track" | "pile" | "bridge" | "ramp" | "swap";
  cell  : number;
  conn  : number;
  dir   : number;
  z     : number;
  take? : boolean;
}

export interface Train {
  p        : number;
  v        : number;
  wood     : number;
  ore      : number;
  track    : number;

  // Seconds into each pair being made (one at most per crafting wagon).
  //
  crafts   : number[];
  fast     : boolean;

  // The cars, front to back (CARS to start with).
  //
  cars     : string[];

  // The dynamite wagon (D6.12): wood and ore put in toward the next
  // stick, seconds into making one (-1 none), and sticks ready.
  //
  dynWood  : number;
  dynOre   : number;
  dynT     : number;
  sticks   : number;
}

// ready: waiting for players on the start pad; waiting: counting down to
// departure; running: the train moves; then one of the three endings.
//
export type Phase = "ready" | "waiting" | "running" | "arrived" | "derailed" | "timeout";

// How far (in cells, Chebyshev) a leaving player's stack may land from
// them before it is given up (D6a.22).
//
export const LEAVE_RADIUS = 4;

export class Game {
  w        : World;
  s        : Settings;
  players  : Map<number, Player>;
  train    : Train;
  phase    : Phase;
  time     : number;
  startT   : number;
  pad      : Pad;
  limit    : number;
  rng      : Rng;
  line     : number[];
  events   : string[];

  // Station upgrades (D6.7): those on offer at the station arrived at,
  // the one picked there ("" none yet), how many of each this run has
  // taken, and the settings a pick just changed ([section, key, value],
  // for the server to tell the clients; it clears them).
  //
  offers   : Offer[];
  picked   : string;
  taken    : Record<string, number>;
  tuned    : [string, string, number][];

  // Lit dynamite put down or thrown (D6.12), and the next one's id.
  //
  bombs    : Bomb[];
  bombId   : number;

  // `fresh` sets the level up (the starting pile); a client making a Game
  // over its copy of the world only to ask plan() passes false.
  //
  constructor(w: World, s: Settings, seed = 1, fresh = true) {
    this.w       = w;
    this.s       = s;
    this.players = new Map();
    this.phase   = "ready";
    this.time    = 0;
    this.startT  = -1;
    this.rng     = new Rng(seed);
    this.events  = [];
    this.line    = w.line();
    this.offers  = [];
    this.picked  = "";
    this.taken   = {};
    this.tuned   = [];
    this.bombs   = [];
    this.bombId  = 1;

    // The train starts with its front at the east edge of the start
    // station (D6a.13): the cars fill the station.
    //
    this.train = { p: (w.lineBack(this.line) + w.start.length - 1) + 0.5, v: 0, wood: 0, ore: 0, track: 0, crafts: [], fast: false,
                   cars: [...CARS], dynWood: 0, dynOre: 0, dynT: -1, sticks: 0 };
    this.pad   = this.padSpot();

    // Starting track: a pile on the ground beside the front of the train,
    // on the start pad's side, for players to pick up and lay (D6.9).
    //
    if ( fresh && (s.rules.startTrack > 0) ) {
      const i = this.pileSpot();
      if (i >= 0) { w.stack[i] = Item.TRACK; w.count[i] = s.rules.startTrack; }
    }
    if (fresh) { w.changed.clear(); }
    this.limit = this.levelLimit();
  }

  // Level timer (D6a.3), counted from the start of the countdown: the
  // start wait plus the time to cover the most track the resources can
  // make, times the slack. Resources are counted between the level's two
  // stations.
  //
  levelLimit(): number {
    const w = this.w, s = this.s,
          { T, R } = w.resourceCounts(w.start[0][0], w.end[w.end.length - 1][0]),
          most     = Math.max(T, R) * s.rules.C;
    return ( s.train.startDelay + ((most / s.train.speed) * s.rules.timerSlack) );
  }

  // Whether the level just arrived at was the run's last (D6.4).
  //
  lastLevel(): boolean { return ( this.w.seg >= (this.w.segments - 1) ); }

  // On to the next level of the run, after arriving (D6.4): the station
  // arrived at is the new start station, where the train already stands
  // (its front at the station's east edge), keeping its load. The
  // countdown to departure starts at once: only the first level waits
  // for the start pad. No new pile of track is given.
  //
  nextSegment(): void {
    if ( (this.phase !== "arrived") || this.lastLevel() ) { return; }
    this.w.setSegment(this.w.seg + 1);
    this.line    = this.w.line();
    this.train   = { ...this.train, p: (this.w.lineBack(this.line) + this.w.start.length - 1) + 0.5, v: 0, fast: false };
    this.pad     = this.padSpot();
    this.limit   = this.levelLimit();
    this.offers  = [];
    this.picked  = "";
    this.events.push("level");
    this.begin();
  }

  // ---- station upgrades (D6.7) ----

  // On arriving at a station other than the last: up to
  // OFFERS_PER_STATION upgrades not yet taken their most, drawn at
  // random, each in a circle beside the station. Wagons are offered only
  // while the train has room for another car.
  //
  offer(): void {
    const room = (this.train.cars.length < MAX_CARS),
          pool = UPGRADES.filter(u => ( ((this.taken[u.kind] ?? 0) < u.max) && ( !u.needs || ((this.taken[u.needs] ?? 0) > 0) ) &&
                                        ( !u.wagon || room ) )).map(u => u.kind),
          kinds = [] as string[];
    while ( (kinds.length < OFFERS_PER_STATION) && pool.length ) { kinds.push(pool.splice(this.rng.int(0, pool.length - 1), 1)[0]); }
    const spots = this.offerSpots(kinds.length);
    this.offers = kinds.slice(0, spots.length).map((kind, k) => ({ kind, x: spots[k][0] + 0.5, y: spots[k][1] + 0.5, progress: 0 }));
    this.picked = "";
  }

  // Free cells at the station's height in the rows just south of the
  // station arrived at (north if those are short; the building stands
  // north), spread along it: the nearest to its west end, middle and east
  // end, at least two cells apart.
  //
  offerSpots(n: number): [number, number][] {
    const w = this.w, st = this.w.end, [x0, sy] = st[0], len = st.length, zs = w.z(w.idx(x0, sy)),
          out = [] as [number, number][];
    for (const side of [1, -1]) {
      const free = [] as [number, number][];
      for (let y = sy + side; Math.abs(y - sy) <= 3; y += side) {
        for (let x = x0 - 1; x <= (x0 + len); x++) {
          if (!w.inside(x, y)) { continue; }
          const i = w.idx(x, y);
          if ( w.walkable(i) && (w.z(i) === zs) && !w.track[i] && !w.stack[i] && !isRamp(w.type(i)) ) { free.push([x, y]); }
        }
      }
      const want = [x0, x0 + Math.floor(len / 2), x0 + len - 1].slice(0, n);
      for (const tx of want) {
        if (out.length >= n) { break; }
        let best: [number, number] | null = null, bd = Infinity;
        for (const c of free) {
          if (out.some(o => (Math.max(Math.abs(o[0] - c[0]), Math.abs(o[1] - c[1])) < 2))) { continue; }
          const d = Math.hypot(c[0] - tx, (c[1] - (sy + (2 * side))) * 1.5);
          if (d < bd) { bd = d; best = c; }
        }
        if (best) { out.push(best); }
      }
      if (out.length >= n) { break; }
    }
    return out;
  }

  // While the train stands at the station: a living player in an offer's
  // circle fills it; full, that upgrade is taken and the others go.
  //
  stepOffers(): void {
    if ( (this.phase !== "arrived") || this.picked || !this.offers.length ) { return; }
    for (const o of this.offers) {
      const on = [...this.players.values()].some(p => ( (p.dead <= 0) && (Math.hypot(p.x - o.x, p.y - o.y) < PAD_RADIUS) ));
      o.progress = ( on ? (o.progress + this.dt) : 0 );
      if (o.progress >= (this.s.station.dwellSeconds - 1e-9)) {
        this.take(o.kind, o);
        this.offers = [];
        return;
      }
    }
  }

  // Apply an upgrade to the settings this game runs on.
  //
  // A wagon (D6.7) joins the back of the train at once. Should the
  // train have no room for it (no car left under MAX_CARS, or no track
  // behind), it is put down where its offer stood, or on the nearest
  // empty cell, for the players to carry to the back later.
  //
  take(kind: string, at: { x: number, y: number } | null = null): void {
    const u = upgrade(kind);
    if (!u) { return; }
    this.picked = kind;
    this.taken[kind] = (this.taken[kind] ?? 0) + 1;
    const tr = this.train, n = tr.cars.length;
    if ( u.wagon && (n < MAX_CARS) && ((tr.p - ((n + 1) * CAR_LEN)) >= -0.5) ) {
      tr.cars = [...tr.cars, u.wagon];
      this.events.push("wagon:" + u.wagon);
      this.shapeTrain();
    }
    else if ( u.wagon && at ) {
      const i = this.emptyNear(Math.floor(at.x), Math.floor(at.y));
      if (i >= 0) { this.w.stack[i] = WAGON_ITEMS[u.wagon]; this.w.count[i] = 1; this.w.touch(i); }
    }
    const s = this.s as unknown as Record<string, Record<string, number>>;
    for (const [sec, key, d] of u.changes) {
      s[sec][key] = s[sec][key] + d;
      this.tuned.push([sec, key, s[sec][key]]);
    }
    this.events.push("upgrade:" + kind);
  }

  // The nearest cell to (x, y) holding nothing that a stack can go on,
  // out to LEAVE_RADIUS cells; -1 if none.
  //
  emptyNear(x: number, y: number): number {
    const w = this.w;
    for (let r = 0; r <= LEAVE_RADIUS; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if ( (Math.max(Math.abs(dx), Math.abs(dy)) !== r) || !w.inside(x + dx, y + dy) ) { continue; }
          const i = w.idx(x + dx, y + dy);
          if ( w.walkable(i) && !w.track[i] && !w.stack[i] && !isRamp(w.type(i)) && (w.type(i) !== Cell.STATION) ) { return i; }
        }
      }
    }
    return -1;
  }

  // Take back every upgrade taken (a new run starts without them);
  // returns the settings changed.
  //
  undoUpgrades(): [string, string, number][] {
    const s = this.s as unknown as Record<string, Record<string, number>>, out = [] as [string, string, number][];
    for (const [kind, n] of Object.entries(this.taken)) {
      for (const [sec, key, d] of (upgrade(kind)?.changes ?? [])) {
        s[sec][key] = s[sec][key] - (d * n);
        out.push([sec, key, s[sec][key]]);
      }
    }
    this.taken = {};
    return out;
  }

  get dt(): number { return ( 1 / this.s.tickHz ); }

  // The start pad's place: a free cell two rows south of the start
  // station's middle (the shelter stands to the north), else the nearest
  // free cell at the station's level.
  //
  padSpot(): Pad {
    const w = this.w, [sx, sy] = w.start[0], mx = sx + Math.floor(w.start.length / 2),
          zs = w.z(w.idx(sx, sy));
    let best = -1, bd = Infinity;
    for (let y = sy - 4; y <= (sy + 4); y++) {
      for (let x = mx - 4; x <= (mx + 4); x++) {
        if ( !w.inside(x, y) || (Math.abs(y - sy) < 2) ) { continue; }
        const i = w.idx(x, y);
        if ( !w.walkable(i) || (w.z(i) !== zs) || w.track[i] || isRamp(w.type(i)) ) { continue; }
        const d = Math.hypot(x - mx, (y - (sy + 2)) * 1.5);
        if (d < bd) { bd = d; best = i; }
      }
    }
    const [x, y] = ( (best >= 0) ? w.xy(best) : [mx, sy + 1] );
    return { x: x + 0.5, y: y + 0.5, progress: 0 };
  }

  // A free cell for the starting track pile: at the station's level, on
  // the pad's side, nearest the cell beside the station's east end.
  //
  pileSpot(anySide = false): number {
    const w = this.w, [ex, sy] = w.start[w.start.length - 1], zs = w.z(w.idx(ex, sy)),
          side = ( (this.pad.y > (sy + 0.5)) ? 1 : -1 ),
          padCell = w.idx(Math.floor(this.pad.x), Math.floor(this.pad.y));
    let best = -1, bd = Infinity;
    for (let y = sy - 3; y <= (sy + 3); y++) {
      for (let x = ex - 3; x <= (ex + 3); x++) {
        if ( !w.inside(x, y) || (y === sy) || ( !anySide && (Math.sign(y - sy) !== side) ) ) { continue; }
        const i = w.idx(x, y);
        if ( (i === padCell) || !w.walkable(i) || (w.z(i) !== zs) || w.track[i] || w.stack[i] || isRamp(w.type(i)) ) { continue; }
        const d = Math.hypot(x - ex, y - (sy + side));
        if (d < bd) { bd = d; best = i; }
      }
    }
    return ( ( (best < 0) && !anySide ) ? this.pileSpot(true) : best );
  }

  // Start the countdown to departure (also used by tests).
  //
  begin(): void {
    this.phase  = "waiting";
    this.startT = this.time;
    this.events.push("countdown");
  }

  stepPad(): void {
    if (this.phase !== "ready") { return; }
    const on = [...this.players.values()].some(p => ( (p.dead <= 0) && (Math.hypot(p.x - this.pad.x, p.y - this.pad.y) < PAD_RADIUS) ));
    this.pad.progress = ( on ? (this.pad.progress + this.dt) : 0 );
    if (this.pad.progress >= (this.s.station.dwellSeconds - 1e-9)) {
      this.pad.progress = this.s.station.dwellSeconds;
      this.begin();
    }
  }

  addPlayer(id: number, name: string, character: string): Player {
    const p: Player = {
      id, name, character, x: 0, y: 0, level: 0, facing: 1, heading: 0, carry: Item.NONE, count: 0,
      hitT: 0, hitting: false, boostT: 0, boostCd: 0, dead: 0, emote: -1, emoteT: 0, lastAction: false,
      lastCell: -1, wedgeT: 0, tool: Tool.NONE, denyT: 0, fuse: -1, aimT: -1,
    };
    this.respawn(p);
    this.players.set(id, p);
    return p;
  }

  // A player who leaves, on purpose or not, drops what they carry
  // (leaveDrop) before going. A dying player drops theirs the same way
  // when they die (kill), so a dead one holds nothing.
  //
  removePlayer(id: number): void {
    const p = this.players.get(id);
    if (p) { this.leaveDrop(p); }
    this.players.delete(id);
  }

  // The storage wagon cell nearest the character among their own cell
  // and its four side neighbours, or -1 if none.
  //
  storageBeside(p: Player): number {
    const n = this.wagonsNear(p).find(e => (this.train.cars[e.car] === "storage"));
    return ( n ? n.cell : -1 );
  }

  // Wagons (storage and crafting) on the character's cell or any of the
  // eight around it (D6a.25, D6a.29), each with its nearest such cell,
  // nearest wagon first.
  //
  // A wagon's distance is to the nearest edge of the cell it covers (0
  // on the cell), so standing close beside a wagon counts as near.
  //
  wagonsNear(p: Player): { car: number, cell: number, d: number }[] {
    const w = this.w, [cx, cy] = w.xy(this.cellOf(p)), best = new Map<number, { car: number, cell: number, d: number }>();
    for (let y = cy - 1; y <= (cy + 1); y++) {
      for (let x = cx - 1; x <= (cx + 1); x++) {
        if (!w.inside(x, y)) { continue; }
        const i = w.idx(x, y), car = this.carAt(i);
        if ( (car < 0) || (this.train.cars[car] === "locomotive") ) { continue; }
        const d = cellEdgeDist(p.x, p.y, x, y), old = best.get(car);
        if ( !old || (d < old.d) ) { best.set(car, { car, cell: i, d }); }
      }
    }
    return [...best.values()].sort((a, b) => (a.d - b.d));
  }

  // Put what the character carries (wood or ore) into the storage wagon
  // beside them, up to rules.storageMax of that kind in the wagon (per
  // resource: that many wood and that many ore). Returns how many
  // went in, or -1 if no storage wagon is beside them.
  //
  storeBeside(p: Player): number {
    if ( ( (p.carry !== Item.WOOD) && (p.carry !== Item.ORE) ) || (this.storageBeside(p) < 0) ) { return -1; }
    const t = this.train, have = ( (p.carry === Item.WOOD) ? t.wood : t.ore ),
          n = Math.max(0, Math.min(p.count, this.storageCap() - have));
    if (p.carry === Item.WOOD) { t.wood += n; } else { t.ore += n; }
    this.spend(p, n);
    return n;
  }

  // Best effort for a leaving player's stack: the nearest cell that can
  // take it, searching rings out to LEAVE_RADIUS cells (Chebyshev) from
  // the player's cell, nearer rings first and the player's own height
  // first within a ring. A cell can take it when it is walkable and not
  // track, a ramp or a station, and holds nothing or the same kind
  // (stacks have no size limit). Only when no cell in range can take it
  // does the stack vanish, with a "lost:<id>:<count>" event. Returns the
  // cell used, or -1.
  //
  leaveDrop(p: Player): number {
    if (p.carry === Item.DYNAMITE) { this.dropStick(p); return -1; }
    if ( (p.carry === Item.NONE) || (p.count <= 0) ) { return -1; }

    // Beside a storage wagon, as much as fits goes in first (D6a.25).
    //
    this.storeBeside(p);
    if (p.count <= 0) { return -1; }
    const w = this.w, [x, y] = w.xy(this.cellOf(p));
    for (let r = 0; r <= LEAVE_RADIUS; r++) {
      const ring = [] as number[];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if ( (Math.max(Math.abs(dx), Math.abs(dy)) !== r) || !w.inside(x + dx, y + dy) ) { continue; }
          const i = w.idx(x + dx, y + dy);
          if ( w.walkable(i) && !w.track[i] && !isRamp(w.type(i)) && (w.type(i) !== Cell.STATION) &&
               ( !w.stack[i] || ( (w.stack[i] === p.carry) && !wagonOf(p.carry) ) ) ) { ring.push(i); }
        }
      }
      ring.sort((i, j) => ( ( (w.z(i) === p.level) ? 0 : 1 ) - ( (w.z(j) === p.level) ? 0 : 1 ) ));
      if (ring.length) {
        const c = ring[0];
        w.stack[c] = p.carry; w.count[c] += p.count;
        w.touch(c);
        this.dropAll(p);
        return c;
      }
    }
    this.events.push("lost:" + p.id + ":" + p.count);
    this.dropAll(p);
    return -1;
  }

  // A free cell near the start station, beside the track (D4.9).
  //
  respawn(p: Player): void {
    const [sx, sy] = this.w.start[0], len = this.w.start.length, spots = [] as number[];
    for (let y = sy - 3; y <= (sy + 3); y++) {
      for (let x = sx; x < (sx + len); x++) {
        if ( (y === sy) || !this.w.inside(x, y) ) { continue; }
        const i = this.w.idx(x, y);
        if ( this.w.walkable(i) && (this.w.z(i) === this.w.z(this.w.idx(sx, sy))) && !this.w.track[i] ) { spots.push(i); }
      }
    }
    // Prefer the start pad's side of the station, so the train is not in
    // the way.
    //
    const side = Math.sign(this.pad.y - (sy + 0.5)),
          near = spots.filter(i => ( Math.sign(this.w.xy(i)[1] - sy) === side )),
          pool = ( near.length ? near : spots );
    const i = ( pool.length ? pool[this.rng.int(0, pool.length - 1)] : this.w.idx(sx, sy) ),
          [x, y] = this.w.xy(i);
    p.x = x + 0.5; p.y = y + 0.5; p.level = this.w.z(i);
    p.dead = 0; p.boostT = 0; p.hitting = false; p.hitT = 0;
  }

  cellOf(p: Player): number { return this.w.idx(Math.floor(p.x), Math.floor(p.y)); }

  // ---- train ----

  // Index into the line of the cell the train's front is in. Track there
  // and behind is fixed (D6a.11).
  //
  frontIndex(): number { return Math.round(this.train.p); }

  // Cells a car occupies, for wagon interactions.
  //
  carAt(i: number): number {
    const k = this.line.indexOf(i);
    if (k < 0) { return -1; }
    for (let c = 0; c < this.train.cars.length; c++) {
      const front = this.train.p - (c * CAR_LEN), back = front - CAR_LEN;
      if ( (k >= back) && (k <= front) ) { return c; }
    }
    return -1;
  }

  lineEnd(): number { return this.line[this.line.length - 1]; }

  stepTrain(): void {
    const t = this.train, s = this.s.train, dt = this.dt;
    if (this.phase === "waiting") {
      if ((this.time - this.startT) >= (s.startDelay - 1e-9)) { this.phase = "running"; this.events.push("start"); }
      return;
    }
    if (this.phase !== "running") { return; }

    // Accelerate from a stop to level speed, then hold it (D6a.4).
    // Fast-forward (D6a.28), while a player holds it or once the line
    // reaches the end station, multiplies the speed by
    // train.fastForward, reached and left within about a second.
    //
    const last = this.w.idx(this.w.end[this.w.end.length - 1][0], this.w.end[this.w.end.length - 1][1]),
          k    = this.line.indexOf(last),
          lv   = this.levelSpeed(),
          top  = lv * Math.max(1, s.fastForward),
          want = ( t.fast ? top : lv ),
          acc  = ( ( t.fast || (t.v > want) ) ? Math.max(s.acceleration, top) : s.acceleration );
    t.v = ( (t.v < want) ? Math.min(want, t.v + (acc * dt)) : Math.max(want, t.v - (acc * dt)) );
    t.p += t.v * dt;

    // Arrival: the front reaches the east edge of the end station.
    if ( (k >= 0) && (t.p >= (k + 0.5)) ) {
      t.p = k + 0.5; t.v = 0;
      this.phase = "arrived";
      this.events.push("arrived");
      if (!this.lastLevel()) { this.offer(); }
      return;
    }

    // Derailment: the front runs past the end of the line (D6a.2).
    //
    if (t.p > ((this.line.length - 1) + 0.5)) {
      this.phase = "derailed";
      this.events.push("derailed");
    }
  }

  // Level speed (D6a.4), with train.speedPerWagon more for each wagon
  // won at a station (each car beyond the starting ones, D6.7).
  //
  levelSpeed(): number {
    const s = this.s.train;
    return ( s.speed + ((s.speedPerWagon ?? 0) * Math.max(0, this.train.cars.length - CARS.length)) );
  }

  // How many cars of a kind the train has.
  //
  carCount(kind: string): number { return this.train.cars.filter(c => (c === kind)).length; }

  // Most of each resource the storage wagons hold, and most track the
  // crafting wagons hold.
  //
  storageCap(): number { return ( this.s.rules.storageMax * this.carCount("storage") ); }
  trackCap(): number   { return ( this.s.rules.trackMax * this.carCount("crafting") ); }

  stepCrafting(): void {
    const t = this.train, C = this.s.rules.C;
    // Each crafting wagon makes one pair at a time. The crafting wagons
    // hold at most trackCap() pieces; a pair is taken only when its
    // pieces, with those being made, will fit (D6a.30).
    //
    while ( (t.crafts.length < this.carCount("crafting")) && (t.wood >= 1) && (t.ore >= 1) &&
            ((t.track + (C * (t.crafts.length + 1))) <= this.trackCap()) ) {
      t.wood--; t.ore--;
      t.crafts.push(0);
    }
    // The dynamite wagon makes a stick once it has what one takes, while
    // it holds fewer than rules.dynamiteMax (D6.12).
    //
    const r = this.s.rules;
    if ( (t.dynT < 0) && this.carCount("dynamite") && (t.dynWood >= r.dynamiteWood) && (t.dynOre >= r.dynamiteOre) && (t.sticks < r.dynamiteMax) ) {
      t.dynWood -= r.dynamiteWood; t.dynOre -= r.dynamiteOre;
      t.dynT = 0;
    }
    if (t.dynT >= 0) {
      t.dynT += this.dt;
      if (t.dynT >= (r.dynamiteSeconds - 1e-9)) { t.dynT = -1; t.sticks++; }
    }
    t.crafts = t.crafts.map(c => (c + this.dt));
    const done = t.crafts.filter(c => (c >= (this.s.rules.craftSecondsPerPair - 1e-9))).length;
    if (done) {
      t.crafts = t.crafts.filter(c => (c < (this.s.rules.craftSecondsPerPair - 1e-9)));
      t.track += C * done;
    }
  }

  // ---- characters ----

  // Collision rules live on the world so the client can draw them.
  //
  enterable(from: number, to: number, boosting: boolean): boolean { return this.w.enterable(from, to, boosting); }
  blocks(from: number, j: number, boosting: boolean): boolean { return this.w.blocks(from, j, boosting); }

  // Move a character by (dx, dy), stopping at cells it cannot enter. The
  // capsule is a circle of radius r in plan. Each axis moves on its own
  // and is pushed back out of any blocking cell it runs into, on the side
  // it came from.
  //
  // The train's collision circles this tick, as points in the level.
  //
  trainPts : { x: number, y: number, z: number }[] = [];

  shapeTrain(): void {
    this.trainPts = trainBody(this.w, this.line, this.train.p, this.s.train.collideRadius, this.train.cars.length);
  }

  // How far a character overlaps the train (0 if not at all).
  //
  trainPen(p: Player): number {
    const R = this.s.train.collideRadius + this.s.avatar.radius;
    let pen = 0;

    // The train blocks at any height (D6a.16): a character above it, on
    // a ledge or boosting off one, cannot drop into it or cross it, also
    // where it climbs a ramp.
    //
    for (const t of this.trainPts) {
      pen = Math.max(pen, R - Math.hypot(p.x - t.x, p.y - t.y));
    }
    return pen;
  }

  // `solidTrain`: walking cannot go deeper into the train (D6a.19); only
  // the train's own push (collide) moves characters without that check.
  //
  move(p: Player, dx: number, dy: number, solidTrain = true): void {
    const r = this.s.avatar.radius, boosting = (p.boostT > 0);
    for (const axis of [0, 1]) {
      const d = ( (axis === 0) ? dx : dy );
      if (d === 0) { continue; }
      const from = this.cellOf(p), ox = p.x, oy = p.y, pen0 = ( solidTrain ? this.trainPen(p) : 0 );
      if (axis === 0) { p.x += d; } else { p.y += d; }
      const cur  = this.cellOf(p),
            base = ( ( (cur !== from) && !this.blocks(from, cur, boosting) ) ? cur : from ),
            cx   = Math.floor(p.x), cy = Math.floor(p.y);
      for (let yy = cy - 1; yy <= (cy + 1); yy++) {
        for (let xx = cx - 1; xx <= (cx + 1); xx++) {
          const j = ( this.w.inside(xx, yy) ? this.w.idx(xx, yy) : -1 );
          if (!this.blocks(base, j, boosting)) { continue; }
          const nx = Math.max(xx, Math.min(xx + 1, p.x)), ny = Math.max(yy, Math.min(yy + 1, p.y));
          if ( (((p.x - nx) ** 2) + ((p.y - ny) ** 2)) >= (r * r) ) { continue; }
          if (axis === 0) {
            if ( (d > 0) && ((xx + 0.5) > p.x) ) { p.x = Math.min(p.x, xx - r - 1e-6); }
            if ( (d < 0) && ((xx + 0.5) < p.x) ) { p.x = Math.max(p.x, xx + 1 + r + 1e-6); }
          }
          else {
            if ( (d > 0) && ((yy + 0.5) > p.y) ) { p.y = Math.min(p.y, yy - r - 1e-6); }
            if ( (d < 0) && ((yy + 0.5) < p.y) ) { p.y = Math.max(p.y, yy + 1 + r + 1e-6); }
          }
        }
      }
      if (solidTrain) {
        const pen = this.trainPen(p);
        if ( (pen > 0) && (pen > (pen0 + 1e-9)) ) { p.x = ox; p.y = oy; }
      }
    }

    // Landing in a new cell: a fall of two levels or more kills (D4.9).
    //
    const c = this.cellOf(p), z = this.w.standZ(c);
    if (z !== p.level) {
      const fall = p.level - z;
      p.level = z;
      if (fall >= 2) { this.kill(p); return; }
    }
  }

  // Death (D6a.31): what the character carries goes down where it died,
  // with the same best effort as a player leaving (leaveDrop: into a
  // storage wagon beside it, else the nearest cell that can take it, and
  // lost only when none in range can). It comes back near the train
  // (respawnNearTrain) after avatar.respawnSeconds.
  //
  kill(p: Player): void {
    this.leaveDrop(p);
    p.dead = this.s.avatar.respawnSeconds;
    p.hitting = false;
    p.boostT  = 0;
    this.events.push("died:" + p.id);
  }

  // A random free cell near the train: walkable, not track, a ramp or a
  // station, at the height of the train cell it is near, one to three
  // cells (Chebyshev) from a cell the train covers. Falls back to the
  // start station's spots (respawn).
  //
  respawnNearTrain(p: Player): void {
    const w = this.w, covered = new Set<number>(), spots = new Set<number>();
    for (const q of trainBody(w, this.line, this.train.p, this.s.train.collideRadius, this.train.cars.length)) {
      if (w.inside(Math.floor(q.x), Math.floor(q.y))) { covered.add(w.idx(Math.floor(q.x), Math.floor(q.y))); }
    }
    for (const i of covered) {
      const [x, y] = w.xy(i), z = w.z(i);
      for (let yy = y - 3; yy <= (y + 3); yy++) {
        for (let xx = x - 3; xx <= (x + 3); xx++) {
          if (!w.inside(xx, yy)) { continue; }
          const j = w.idx(xx, yy);
          if ( covered.has(j) || !w.walkable(j) || w.track[j] || isRamp(w.type(j)) || (w.type(j) === Cell.STATION) || (w.z(j) !== z) ) { continue; }
          spots.add(j);
        }
      }
    }
    const pool = [...spots].sort((a, b) => (a - b));
    if (!pool.length) { this.respawn(p); return; }
    const i = pool[this.rng.int(0, pool.length - 1)], [x, y] = w.xy(i);
    p.x = x + 0.5; p.y = y + 0.5; p.level = w.z(i);
  }

  // The cell a character acts on: the neighbour it faces (D6a.15).
  //
  target(p: Player): number { return this.w.step(this.cellOf(p), p.facing); }

  // What a forest or grey rock block yields.
  //
  yieldOf(i: number): ItemKind {
    const c = this.w.type(i);
    return ( (c === Cell.TREE) ? Item.WOOD : ( (c === Cell.ROCK) ? Item.ORE : Item.NONE ) );
  }

  // A wagon is carried one at a time (D6.7); anything else up to
  // rules.carryMax.
  //
  give(p: Player, kind: ItemKind, n: number): number {
    if ( (p.carry !== Item.NONE) && (p.carry !== kind) ) { return 0; }
    const take = Math.min(n, ( ( wagonOf(kind) || (kind === Item.DYNAMITE) ) ? 1 : this.s.rules.carryMax ) - p.count);
    if (take <= 0) { return 0; }
    p.carry = kind;
    p.count += take;
    return take;
  }

  dropAll(p: Player): void { p.carry = Item.NONE; p.count = 0; }

  // What pressing the action button would build, if anything: track on
  // the cell the character stands on, or, standing on the line's open
  // end, on the faced cell beyond it (D6a.24); a bridge from a ledge onto the
  // faced cell (D4.8); or a ramp (D4.7), on its own cell against a face
  // one level up ahead, on the faced cell one level down (over the
  // edge, rising back toward the character), or on the faced cell at its
  // level against a face one level up beyond it.
  //
  plan(x: number, y: number, facing: number, carry: number, count: number): Plan | null {
    const w = this.w, cx = Math.floor(x), cy = Math.floor(y);
    if (!w.inside(cx, cy)) { return null; }
    const c = w.idx(cx, cy), t = w.step(c, facing), zc = w.z(c);

    // Nothing is built from on top of grey rock (D4.15).
    //
    if (w.type(c) === Cell.ROCK) { return null; }
    const free = (i: number) => ( (i >= 0) && w.walkable(i) && !isRamp(w.type(i)) && !w.track[i] && !w.stack[i] && (w.type(i) !== Cell.STATION) );
    // A ramp may lead up to a tree or grey rock, so a character can climb
    // to it and clear it (D4.7).
    //
    const upFace = (i: number, d: number) => {
      const u = w.step(i, d), cu = ( (u >= 0) ? w.type(u) : -1 );
      return ( (u >= 0) && (w.z(u) === (w.z(i) + 1)) && w.solidTop(u) && ( w.walkable(u) || (cu === Cell.TREE) || (cu === Cell.ROCK) ) );
    };

    // Track joins the train's line when laid next to it; away from the
    // line, several pieces go down as a pile instead (D6a.19).
    //
    if (carry === Item.TRACK) {

      // A stack of wood, ore or track on the cell where the next piece of
      // the line goes (D6a.27). With one piece in hand, the piece is laid
      // there and the stack comes into the hands (`take`), if the hands
      // can hold it all. With more pieces, hands and stack swap; a pile
      // of track meets track in hand as any stack does.
      //
      const end = this.lineEnd();
      const stacked = (i: number): Plan | null => {
        if ( (i < 0) || !w.stack[i] || !w.walkable(i) || w.track[i] || (w.type(i) === Cell.STATION) ) { return null; }
        const dirs = w.joinDirs(i, end);
        if (!dirs.some(d => (w.step(i, d) === end))) { return null; }
        if ( (count === 1) && (w.count[i] <= this.s.rules.carryMax) ) {
          let conn = 0;
          for (const d of dirs) { conn |= (1 << d); }
          return { kind: "track", cell: i, conn, dir: -1, z: w.z(i), take: true };
        }
        return ( (w.stack[i] !== Item.TRACK) ? { kind: "swap", cell: i, conn: 0, dir: -1, z: w.z(i) } : null );
      };

      // On the open end of the train's line: the faced cell, if track can
      // go there and a piece there joins this end.
      //
      if ( w.track[c] && (c === end) ) {
        if ( (t >= 0) && w.stack[t] ) { return stacked(t); }
        if ( (t < 0) || !w.trackAllowed(t) ) { return null; }
        const dirs = w.joinDirs(t, c);
        if (!dirs.some(d => (w.step(t, d) === c))) { return null; }
        let conn = 0;
        for (const d of dirs) { conn |= (1 << d); }
        return { kind: "track", cell: t, conn, dir: -1, z: w.z(t) };
      }
      const st = ( w.stack[c] ? stacked(c) : null );
      if (st) { return st; }
      if (!w.trackAllowed(c)) { return null; }
      const dirs = w.joinDirs(c, this.lineEnd());
      let conn = 0;
      for (const d of dirs) { conn |= (1 << d); }
      const onLine = dirs.some(d => this.line.includes(w.step(c, d)));
      if ( !onLine && (count > 1) ) { return { kind: "pile", cell: c, conn: 0, dir: -1, z: zc }; }
      return { kind: "track", cell: c, conn, dir: -1, z: zc };
    }
    if (t < 0) { return null; }
    if ( (carry === Item.WOOD) && (count >= this.s.rules.bridgeTrees) ) {
      const lower = ( w.walkable(t) && (w.z(t) < zc) && !w.track[t] && !w.stack[t] && !isRamp(w.type(t)) && (w.type(t) !== Cell.STATION) ),
            water = ( (w.type(t) === Cell.WATER) && !w.bridge[t] && (w.z(t) <= zc) );
      if (lower || water) { return { kind: "bridge", cell: t, conn: 0, dir: -1, z: zc }; }
    }
    if (carry === Item.ORE) {
      if ( free(c) && upFace(c, facing) ) { return { kind: "ramp", cell: c, conn: 0, dir: facing, z: zc }; }
      if ( free(t) && (w.z(t) === (zc - 1)) && w.solidTop(c) ) { return { kind: "ramp", cell: t, conn: 0, dir: opposite(facing), z: zc - 1 }; }
      if ( free(t) && (w.z(t) === zc) && upFace(t, facing) ) { return { kind: "ramp", cell: t, conn: 0, dir: facing, z: zc }; }
    }
    return null;
  }

  spend(p: Player, n: number): void {
    p.count -= n;
    if (p.count <= 0) { p.count = 0; p.carry = Item.NONE; }
  }

  // One press of the action button (D6a.15, as revised in D6a.18): the
  // wagons are used from beside them; track, stacks and dropping act on
  // the cell the character stands on; bridges and ramps as in plan().
  //
  press(p: Player): void {
    if (p.tool !== Tool.NONE) { return; }
    const w = this.w, c = this.cellOf(p);

    // Carrying a wagon beside the last car: it joins the train at the
    // back (D6.7), if the train has room for it and there is track under
    // where it would stand.
    //
    const kind = wagonOf(p.carry), tr0 = this.train, n0 = tr0.cars.length;
    if ( kind && this.wagonsNear(p).some(e => (e.car === (n0 - 1))) ) {
      if ( (n0 >= MAX_CARS) || ((tr0.p - ((n0 + 1) * CAR_LEN)) < -0.5) ) { p.denyT = this.s.avatar.denySeconds; return; }
      tr0.cars = [...tr0.cars, kind];
      this.dropAll(p);
      this.events.push("wagon:" + kind);
      this.shapeTrain();
      return;
    }

    // Wagons, from any cell around them, diagonals included, whichever
    // way the character faces; the nearest wagon that can take or give
    // acts (D6a.25, D6a.29). Wood or ore goes into the storage wagon, as
    // much as fits; when none fits it goes down on the character's own
    // cell if that is free or holds the same kind, and only failing
    // that does a refusal show (D6a.33). Empty hands take
    // back from the storage wagon (D6a.21); empty hands or track take
    // track from the crafting wagon. Crafting takes a pair as soon as
    // there is one, so the storage wagon holds only one kind at a time.
    //
    // Empty hands with a stack on their own cell as well: the stack wins
    // if the character is nearer its cell's centre than the wagon's
    // nearest cell edge (D6a.32).
    //
    const tr = this.train,
          here = Math.hypot((Math.floor(p.x) + 0.5) - p.x, (Math.floor(p.y) + 0.5) - p.y);
    for (const { car, d } of this.wagonsNear(p)) {
      if ( (p.carry === Item.NONE) && this.w.stack[this.cellOf(p)] && (here < d) ) { break; }
      if (tr.cars[car] === "storage") {
        if ( (p.carry === Item.WOOD) || (p.carry === Item.ORE) ) {
          if (this.storeBeside(p) !== 0) { return; }
          const free = ( w.walkable(c) && !w.track[c] && !isRamp(w.type(c)) && ( !w.stack[c] || (w.stack[c] === p.carry) ) );
          if (!free) { p.denyT = this.s.avatar.denySeconds; return; }
          w.stack[c] = p.carry; w.count[c] += p.count;
          this.dropAll(p);
          w.touch(c);
          return;
        }
        if ( (p.carry === Item.NONE) && ( (tr.wood > 0) || (tr.ore > 0) ) ) {
          if (tr.wood > 0) { tr.wood -= this.give(p, Item.WOOD, tr.wood); }
          else             { tr.ore  -= this.give(p, Item.ORE, tr.ore); }
          return;
        }
      }
      // The dynamite wagon (D6.12) takes wood and ore toward the next
      // stick (up to what one stick needs), and gives a stick to empty
      // hands.
      //
      if (tr.cars[car] === "dynamite") {
        const r = this.s.rules,
              n = ( (p.carry === Item.WOOD) ? Math.min(p.count, r.dynamiteWood - tr.dynWood) :
                  ( (p.carry === Item.ORE)  ? Math.min(p.count, r.dynamiteOre - tr.dynOre) : 0 ) );
        if (n > 0) {
          if (p.carry === Item.WOOD) { tr.dynWood += n; } else { tr.dynOre += n; }
          this.spend(p, n);
          return;
        }
        if ( (p.carry === Item.NONE) && (tr.sticks > 0) ) {
          tr.sticks -= this.give(p, Item.DYNAMITE, 1);
          p.fuse = -1; p.aimT = -1;
          return;
        }
      }
      if ( (tr.cars[car] === "crafting") && ( (p.carry === Item.NONE) || (p.carry === Item.TRACK) ) && (tr.track > 0) &&
           (p.count < this.s.rules.carryMax) ) {
        tr.track -= this.give(p, Item.TRACK, tr.track);
        return;
      }
    }

    // Track under the character that the train has not reached can be
    // picked up again (D6a.11). Track on the train's line only with
    // empty hands (D6a.23): with track in hand, the press goes on to the
    // usual build, so standing on the line lays the next piece.
    //
    const k = ( w.track[c] ? this.line.indexOf(c) : -1 );
    if ( w.track[c] && (w.type(c) !== Cell.STATION) && ( (p.carry === Item.NONE) || ( (p.carry === Item.TRACK) && (k < 0) ) ) ) {
      if ( (k >= 0) && (k <= this.frontIndex()) ) { return; }
      if (this.give(p, Item.TRACK, 1)) { w.liftTrack(c); this.line = w.line(); }
      return;
    }

    const pl = this.plan(p.x, p.y, p.facing, p.carry, p.count);
    if ( pl && (pl.kind === "track") && pl.take ) {
      const kind = w.stack[pl.cell] as ItemKind, n = w.count[pl.cell];
      w.stack[pl.cell] = Item.NONE; w.count[pl.cell] = 0;
      if (w.layTrack(pl.cell, this.lineEnd())) { this.spend(p, 1); this.line = w.line(); this.give(p, kind, n); }
      else                                     { w.stack[pl.cell] = kind; w.count[pl.cell] = n; }
      w.touch(pl.cell);
      return;
    }
    if (pl && (pl.kind === "track")) {
      if (w.layTrack(pl.cell, this.lineEnd())) { this.spend(p, 1); this.line = w.line(); }
      return;
    }
    if (pl && (pl.kind === "swap")) {
      const kind = w.stack[pl.cell], n = w.count[pl.cell];
      w.stack[pl.cell] = p.carry; w.count[pl.cell] = p.count;
      p.carry = kind as ItemKind; p.count = n;
      w.touch(pl.cell);
      return;
    }
    if (pl && (pl.kind === "pile")) {
      w.stack[c] = Item.TRACK; w.count[c] = p.count;
      this.dropAll(p);
      w.touch(c);
      return;
    }
    if (pl && (pl.kind === "bridge")) {
      w.bridge[pl.cell] = 1;
      w.g.height[pl.cell] = pl.z;
      if (w.type(pl.cell) !== Cell.WATER) { w.g.cells[pl.cell] = Cell.GROUND; }
      w.touch(pl.cell);
      this.spend(p, this.s.rules.bridgeTrees);
      return;
    }
    if (pl && (pl.kind === "ramp")) {
      w.g.cells[pl.cell] = Cell.RAMP_GROUND;
      w.g.dir[pl.cell]   = pl.dir;
      w.touch(pl.cell);
      this.spend(p, 1);
      return;
    }

    // Stacks, on the cell the character stands on (D6a.14).
    //
    if (w.stack[c]) {
      const kind = w.stack[c] as ItemKind;
      if (p.carry === Item.NONE) {
        w.count[c] -= this.give(p, kind, w.count[c]);
      }
      else if ( (p.carry === kind) && !wagonOf(kind) ) {
        w.count[c] += p.count;
        this.dropAll(p);
      }
      else {
        const k2 = p.carry, n2 = p.count;
        p.carry = kind; p.count = w.count[c];
        w.stack[c] = k2; w.count[c] = n2;
      }
      if (!w.count[c]) { w.stack[c] = Item.NONE; }
      w.touch(c);
      return;
    }
    if ( (p.carry !== Item.NONE) && w.walkable(c) && !w.track[c] && !isRamp(w.type(c)) ) {
      w.stack[c] = p.carry; w.count[c] = p.count;
      this.dropAll(p);
      w.touch(c);
    }
  }

  // Holding the action button at a block keeps hitting it (D6a.8), with
  // the matching tool: the axe for trees, the pickaxe for grey rock
  // (D6a.20). Hands hold the tool, so the yield lands on the block's
  // cell, which is ground once the block is gone.
  //
  hold(p: Player): void {
    const w = this.w, t = this.target(p), kind = ( (t >= 0) ? this.yieldOf(t) : Item.NONE ),
          need = ( (kind === Item.WOOD) ? Tool.AXE : Tool.PICK );
    // Grey rock can be mined from beside its base or from beside its top
    // (standing on a neighbouring rock or ledge, D4.15). From a ramp, the
    // cell it leads up to is in reach too (D4.7), so a ramp built against
    // a tree or grey rock one level up lets a character clear it.
    //
    const c = this.cellOf(p),
          upRamp = ( isRamp(w.type(c)) && (w.step(c, w.g.dir[c]) === t) && (w.z(t) === (w.z(c) + 1)) );
    const reach = ( (w.z(t) === p.level) || ( (w.type(t) === Cell.ROCK) && (w.standZ(t) === p.level) ) || upRamp );
    if ( (kind === Item.NONE) || !reach || (p.tool !== need) ) { p.hitting = false; p.hitT = 0; return; }
    p.hitting = true;
    p.hitT += this.dt;
    if (p.hitT < (this.s.rules.hitSeconds - 1e-9)) { return; }
    p.hitT = 0;
    w.hits[t]++;
    w.touch(t);
    if (w.hits[t] < this.s.rules.hitsPerBlock) { return; }
    w.hits[t] = 0;
    w.g.cells[t] = Cell.GROUND;
    w.stack[t] = kind; w.count[t] = 1;
    p.hitting = false;
  }

  // Taking out a tool frees the hands: what the character carries goes
  // onto its own cell or, failing that, a neighbouring one (sides first,
  // then corners). With nowhere to put it the switch is refused, and
  // denyT shows the refusal (D6a.20).
  //
  setTool(p: Player, tool: number): void {
    if (tool === p.tool) { return; }
    if ( (tool !== Tool.NONE) && (p.carry === Item.DYNAMITE) ) { p.denyT = this.s.avatar.denySeconds; return; }
    if ( (tool !== Tool.NONE) && (p.carry !== Item.NONE) ) {
      const c = this.dropSpot(p), w = this.w;
      if (c < 0) { p.denyT = this.s.avatar.denySeconds; return; }
      w.stack[c] = p.carry; w.count[c] += p.count;
      this.dropAll(p);
      w.touch(c);
    }
    p.tool = tool; p.hitting = false; p.hitT = 0;
  }

  dropSpot(p: Player): number {
    const w = this.w, [x, y] = w.xy(this.cellOf(p));
    const near = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of near) {
      if (!w.inside(x + dx, y + dy)) { continue; }
      const i = w.idx(x + dx, y + dy);
      if ( w.walkable(i) && (w.z(i) === p.level) && !w.track[i] && !isRamp(w.type(i)) &&
           (w.type(i) !== Cell.STATION) && ( !w.stack[i] || (w.stack[i] === p.carry) ) ) { return i; }
    }
    return -1;
  }

  stepPlayer(p: Player, inp: Input): void {
    const dt = this.dt;
    if (p.dead > 0) {
      p.dead -= dt;
      if (p.dead <= 0) { this.respawnNearTrain(p); }
      return;
    }
    if (inp.emote >= 0) { p.emote = inp.emote; p.emoteT = 3; this.events.push("emote:" + p.id + ":" + inp.emote); }
    p.emoteT = Math.max(0, p.emoteT - dt);
    p.denyT  = Math.max(0, p.denyT - dt);
    if (inp.idle) { return; }
    if (inp.tool >= 0) {
      const k = TOOL_ORDER.indexOf(p.tool as never), n = TOOL_ORDER.length;
      const t = ( (inp.tool === TOOL_NEXT) ? TOOL_ORDER[(k + 1) % n] :
                ( (inp.tool === TOOL_PREV) ? TOOL_ORDER[(k + n - 1) % n] : inp.tool ) );
      if (t <= Tool.AXE) { this.setTool(p, t); }
    }

    this.walk(p, inp);
    if (p.dead > 0) { return; }

    // Walking over a stack of what one carries picks it up (D6a.14).
    // Carrying track, walking onto a laid piece that is not part of the
    // train's line picks that piece up too (D6a.18); only on entering the
    // cell, so a piece just laid where one stands stays down.
    //
    const c = this.cellOf(p), w = this.w, entered = (c !== p.lastCell);
    p.lastCell = c;
    if ( (p.tool === Tool.NONE) && (p.carry !== Item.NONE) && (w.stack[c] === p.carry) ) {
      w.count[c] -= this.give(p, p.carry, w.count[c]);
      if (!w.count[c]) { w.stack[c] = Item.NONE; }
      w.touch(c);
    }

    // Carrying track beside the crafting wagon (any of the eight cells
    // around it) takes track from it the same way (D6a.30).
    //
    if ( (p.tool === Tool.NONE) && (p.carry === Item.TRACK) && (p.count < this.s.rules.carryMax) && (this.train.track > 0) &&
         this.wagonsNear(p).some(e => (this.train.cars[e.car] === "crafting")) ) {
      this.train.track -= this.give(p, Item.TRACK, this.train.track);
    }
    if ( entered && (p.tool === Tool.NONE) && (p.carry === Item.TRACK) && w.track[c] && (w.type(c) !== Cell.STATION) &&
         !this.line.includes(c) && this.give(p, Item.TRACK, 1) ) {
      w.liftTrack(c);
      this.line = w.line();
    }

    if ( (p.carry === Item.DYNAMITE) && (p.tool === Tool.NONE) ) {
      this.stick(p, inp);
      p.lastAction = inp.action;
      return;
    }
    if (inp.action && !p.lastAction) { this.press(p); }
    if (inp.action) { this.hold(p); } else { p.hitting = false; p.hitT = 0; }
    p.lastAction = inp.action;
  }

  // ---- dynamite (D6.12) ----

  // A stick in hand. Unlit: a press beside the dynamite wagon puts it
  // back, anywhere else lights it. Lit: a press starts aiming; let go
  // after less than TAP seconds and it is put down at the feet, later and
  // it is thrown the way the character faces, the farther the longer the
  // press (full after rules.throwHoldSeconds). Its fuse burns on in the
  // game's tick (fuses()).
  //
  stick(p: Player, inp: Input): void {
    const down = ( inp.action && !p.lastAction ), r = this.s.rules, tr = this.train;
    p.hitting = false; p.hitT = 0;
    if (p.fuse < 0) {
      if (!down) { return; }
      if ( this.wagonsNear(p).some(e => (tr.cars[e.car] === "dynamite")) && (tr.sticks < r.dynamiteMax) ) {
        tr.sticks++;
        this.dropAll(p);
        return;
      }
      p.fuse = r.fuseSeconds;
      this.events.push("lit:" + p.id);
      return;
    }
    if (down) { p.aimT = 0; return; }
    if ( inp.action && (p.aimT >= 0) ) { p.aimT += this.dt; return; }
    if ( !inp.action && (p.aimT >= 0) ) {
      const power = ( (p.aimT < TAP) ? 0 : Math.min(1, p.aimT / Math.max(1e-6, r.throwHoldSeconds)) );
      this.bombs.push(launch(this.w, this.bombId++, p.x, p.y, p.heading, power, r.throwRange, p.fuse));
      this.events.push( ( (power > 0) ? "throw:" : "place:" ) + p.id );
      this.dropAll(p);
      p.fuse = -1; p.aimT = -1;
    }
  }

  // A stick leaving a player's hands other than by a throw (a death, the
  // player leaving): lit, it lies where they stood and still goes off;
  // unlit, it is lost.
  //
  dropStick(p: Player): void {
    if (p.fuse >= 0) { this.bombs.push(launch(this.w, this.bombId++, p.x, p.y, p.heading, 0, 0, p.fuse)); }
    this.dropAll(p);
    p.fuse = -1; p.aimT = -1;
  }

  // Every tick: fuses burn, in hand and on the ground; sticks fly.
  //
  fuses(): void {
    for (const p of this.players.values()) {
      if ( (p.carry !== Item.DYNAMITE) || (p.fuse < 0) ) { continue; }
      p.fuse -= this.dt;
      if (p.fuse <= 0) {
        const x = p.x, y = p.y, z = floorAt(this.w, x, y);
        this.dropAll(p);
        p.fuse = -1; p.aimT = -1;
        this.blast(x, y, z);
      }
    }
    const left = [] as Bomb[];
    for (const b of this.bombs) {
      stepBomb(this.w, b, this.dt);
      b.fuse -= this.dt;
      if (b.fuse <= 0) { this.blast(b.x, b.y, b.z); }
      else             { left.push(b); }
    }
    this.bombs = left;
  }

  // A blast at (x, y, z): trees and grey rock within rules.blastRadius
  // become ground, each leaving what a chop or a mine would (one wood or
  // one ore on its cell), so a blast both clears and gathers; black rock,
  // track, bridges, stacks and the train are untouched. Players within the
  // radius, and not more than a level and a half above or below, die.
  //
  blast(x: number, y: number, z: number): void {
    const w = this.w, R = this.s.rules.blastRadius;
    for (let cy = Math.floor(y - R); cy <= Math.floor(y + R); cy++) {
      for (let cx = Math.floor(x - R); cx <= Math.floor(x + R); cx++) {
        if ( !w.inside(cx, cy) || (Math.hypot((cx + 0.5) - x, (cy + 0.5) - y) > R) ) { continue; }
        const i = w.idx(cx, cy), c = w.type(i);
        if ( (c === Cell.TREE) || (c === Cell.ROCK) ) {
          const kind = this.yieldOf(i);
          w.g.cells[i] = Cell.GROUND;
          w.hits[i] = 0;
          w.stack[i] = kind; w.count[i] = 1;
          w.touch(i);
        }
      }
    }
    for (const p of this.players.values()) {
      if (p.dead > 0) { continue; }
      const pz = floorAt(w, p.x, p.y);
      if ( (Math.hypot(p.x - x, p.y - y) <= R) && (Math.abs(pz - z) <= (1.5 * LEVEL_Y)) ) { this.kill(p); }
    }
    this.events.push("boom:" + x.toFixed(2) + ":" + y.toFixed(2) + ":" + z.toFixed(2));
  }

  // One input's movement: boost timers, facing and heading, then the walk
  // or boost itself.
  //
  walk(p: Player, inp: Input): void {
    const a = this.s.avatar, dt = this.dt;
    p.boostCd = Math.max(0, p.boostCd - dt);
    p.boostT  = Math.max(0, p.boostT - dt);
    if ( inp.boost && (p.boostCd <= 0) ) { p.boostT = a.boostSeconds; p.boostCd = a.boostCooldown; }

    let mx = inp.mx, my = inp.my;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    if (len > 0.01) {
      p.facing  = ( (Math.abs(mx) >= Math.abs(my)) ? ( (mx > 0) ? 1 : 3 ) : ( (my > 0) ? 2 : 0 ) );
      p.heading = Math.atan2(my, mx);
    }

    // A boost goes along the heading, the way the character faces.
    //
    if (p.boostT > 0) {
      this.move(p, Math.cos(p.heading) * a.boostSpeed * dt, Math.sin(p.heading) * a.boostSpeed * dt);
    }
    else {
      this.move(p, mx * a.walkSpeed * dt, my * a.walkSpeed * dt);
    }
  }

  // ---- collisions (D6a.16) ----

  // The train pushes characters aside; one that cannot get out of the way
  // dies. Characters push each other apart softly.
  //
  collide(): void {
    const a = this.s.avatar, dt = this.dt, r = a.radius, R = this.s.train.collideRadius;
    const ps = [...this.players.values()].filter(p => (p.dead <= 0));
    const qs = trainBody(this.w, this.line, this.train.p, R, this.train.cars.length);
    for (const p of ps) {

      // Sum the pushes of every circle touching the character: sideways
      // from the track, toward the character's side, weighted by depth.
      //
      let sx = 0, sy = 0, deep = 0, hx = 0, hy = 0;
      for (const pose of qs) {
        const dx = p.x - pose.x, dy = p.y - pose.y, depth = (R + r) - Math.hypot(dx, dy);
        if (depth <= 0) { continue; }
        const nx = -Math.sin(pose.heading), ny = Math.cos(pose.heading),
              side = ( (((dx * nx) + (dy * ny)) >= 0) ? 1 : -1 );
        sx += nx * side * depth; sy += ny * side * depth;
        if (depth > deep) { deep = depth; hx = Math.cos(pose.heading); hy = Math.sin(pose.heading); }
      }
      if (deep <= 0) { p.wedgeT = 0; continue; }

      // One capped push per tick, in the first direction that is free and
      // does not take the character deeper into the train: straight away
      // from the train, away and ahead along the track, ahead along the
      // track. A character squeezed toward a wall slides out along it;
      // one held pinned for wedgeSeconds dies.
      //
      const len = Math.hypot(sx, sy) || 1, ux = sx / len, uy = sy / len,
            step = Math.min(deep, a.pushSpeed * dt) + 1e-4,
            dirs = [[ux, uy], [ux + hx, uy + hy], [hx, hy]];
      let stuck = true;
      for (const [vx, vy] of dirs) {
        const vl = Math.hypot(vx, vy) || 1, bx = p.x, by = p.y, pen0 = this.trainPen(p);
        this.move(p, (vx / vl) * step, (vy / vl) * step, false);
        if (p.dead > 0) { break; }
        if (this.trainPen(p) > (pen0 + 1e-9)) { p.x = bx; p.y = by; continue; }
        if (Math.hypot(p.x - bx, p.y - by) >= (step * 0.5)) { stuck = false; break; }
      }
      if (p.dead > 0) { continue; }
      p.wedgeT = ( stuck ? (p.wedgeT + dt) : 0 );
      if ( (p.dead <= 0) && (p.wedgeT >= a.wedgeSeconds) ) { p.wedgeT = 0; this.kill(p); }
    }
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const p = ps[i], q = ps[j];
        if (p.level !== q.level) { continue; }
        const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1e-6, depth = (2 * r) - d;
        if (depth <= 0) { continue; }
        const k = Math.min(depth, a.pushSpeed * dt) * 0.5;
        this.move(p, -(dx / d) * k, -(dy / d) * k);
        this.move(q, (dx / d) * k, (dy / d) * k);
      }
    }
  }

  // ---- tick ----

  // Characters keep moving after the level ends; the train, crafting and
  // the timer stop.
  //
  ended(): boolean { return ( (this.phase === "derailed") || (this.phase === "timeout") || (this.phase === "arrived") ); }

  // A player's entry in `inputs` is one input or several, applied in
  // order within this tick (the server passes every input that came in,
  // so each is applied exactly once, D7.4); none, or an empty list,
  // counts as NO_INPUT.
  //
  tick(inputs: Map<number, Input | Input[]>): void {
    this.time += this.dt;
    this.shapeTrain();
    const listOf = (id: number) => {
      const got = inputs.get(id), list = ( Array.isArray(got) ? got : ( got ? [got] : [] ) );
      return ( list.length ? list : [NO_INPUT] );
    };
    for (const p of this.players.values()) {
      for (const inp of listOf(p.id)) { this.stepPlayer(p, inp); }
    }

    // Fast-forward: any living player holding it, or the line joined to
    // the end station (D6a.28).
    //
    const endCell = this.w.idx(this.w.end[this.w.end.length - 1][0], this.w.end[this.w.end.length - 1][1]);
    this.train.fast = ( this.line.includes(endCell) ||
                        [...this.players.values()].some(p => ( !p.dead && listOf(p.id).some(i => (i.fast === true)) )) );
    if (!this.ended()) {
      this.stepPad();
      this.stepCrafting();
      this.stepTrain();
    }
    this.stepOffers();
    this.fuses();
    this.shapeTrain();
    this.collide();
    if ( (this.phase === "running") && ((this.time - this.startT) > this.limit) ) {
      this.phase = "timeout";
      this.events.push("timeout");
    }
  }
}

export { opposite };
