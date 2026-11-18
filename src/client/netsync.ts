// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Hiding network delay (D7.4). No three.js here, so it can be tested
// without a browser.
//
// Own character (Predictor): the page steps its own inputs at the
// server's tick rate, numbered, and applies each at once with the same
// player step the server runs (Game.stepPlayer): moving, boosting,
// picking up, pressing, chopping and mining, changing tools. It does
// that on a display copy of the world (`disp`), which is what the page
// draws, so a pickup or a chop shows straight away. The page keeps the
// server's own copy (`truth`) apart. Each server state says which input
// it has applied up to (`ack`); the page resets the display copy and its
// character to the server's and replays the inputs the server has not
// applied yet. Where the server disagreed, the display copy follows the
// server from then on: the server is the truth. A change of place (the
// train pushed, a teammate bumped) is eased out over a short time
// instead of jumping, unless it is large (a respawn).
//
// Everything else (Interp): server states are kept with their server
// time, and other characters and the train are drawn DELAY seconds in the
// past, between the two states either side of that time, so uneven
// arrival does not show as jerks.
//

import type { Game, Input, Player, Train } from "../sim/game.ts";
import type { World, ItemKind } from "../sim/world.ts";
import type { PlayerView } from "../net/protocol.ts";

// A correction larger than SNAP cells is shown at once (respawns,
// teleports); smaller ones fade with time constant EASE seconds.
//
const SNAP = 1.5,
      EASE = 0.12;

export class Predictor {
  sim     : Game;
  truth   : World;
  me      : Player | null;
  pending : { seq: number, inp: Input }[];
  seq     : number;

  // The character's place before and after the latest input step, for
  // drawing between steps, and the eased-out correction.
  //
  prev    : { x: number, y: number };
  cur     : { x: number, y: number };
  err     : { x: number, y: number };

  // sim: a Game over the display copy of the world; truth: the world as
  // the server last said, a separate copy of the same level.
  //
  constructor(sim: Game, truth: World) {
    this.sim     = sim;
    this.truth   = truth;
    this.me      = null;
    this.pending = [];
    this.seq     = 0;
    this.prev    = { x: 0, y: 0 };
    this.cur     = { x: 0, y: 0 };
    this.err     = { x: 0, y: 0 };
  }

  // One input step: numbered, kept until the server has applied it, and
  // applied here at once. Returns its seq.
  //
  step(inp: Input): number {
    this.seq++;
    this.pending.push({ seq: this.seq, inp });
    if (this.pending.length > 200) { this.pending.shift(); }
    const me = this.me;
    if (me) {
      this.prev = { ...this.cur };
      this.apply(me, inp);
      this.cur = { x: me.x, y: me.y };
    }
    return this.seq;
  }

  // The server's player step, while alive (coming back after a death is
  // the server's to place).
  //
  // (A stick thrown or put down here is left to the server: the page
  // draws sticks from its states.)
  //
  private apply(me: Player, inp: Input): void {
    if (me.dead > 0) { return; }
    this.sim.stepPlayer(me, inp);
    this.sim.events = [];
    this.sim.bombs  = [];
  }

  // A server state (its cells already applied to `truth`): reset the
  // display copy, the train and this character to the server's, and
  // replay the inputs it has not applied yet.
  //
  reconcile(v: PlayerView, train: Train): void {
    this.pending = this.pending.filter(e => (e.seq > v.ack));
    const sim = this.sim, old = this.me;
    sim.w.copyFrom(this.truth);
    sim.train = { ...train };
    sim.line  = sim.w.line();
    sim.shapeTrain();
    const me: Player = {
      id: v.id, name: v.name, character: v.character, x: v.x, y: v.y, level: v.level, facing: v.facing, heading: v.heading,
      carry: v.carry as ItemKind, count: v.count, hitT: v.hitT, hitting: v.hitting, boostT: v.boostT, boostCd: v.boostCd,
      dead: ( v.dead ? 1 : 0 ), emote: v.emote, emoteT: v.emoteT, lastAction: v.lastAction, lastCell: v.lastCell, wedgeT: 0,
      tool: v.tool, denyT: v.denyT, fuse: v.fuse, aimT: v.aimT,
    };
    for (const e of this.pending) { this.apply(me, e.inp); }
    this.me = me;

    // Keep what is drawn where it was: shift the step ends by the change
    // and carry the change in err, which fades.
    //
    const dx = ( old ? (me.x - old.x) : 0 ), dy = ( old ? (me.y - old.y) : 0 );
    if ( !old || (Math.hypot(dx, dy) > SNAP) ) {
      this.prev = { x: me.x, y: me.y };
      this.cur  = { x: me.x, y: me.y };
      this.err  = { x: 0, y: 0 };
      return;
    }
    this.prev = { x: this.prev.x + dx, y: this.prev.y + dy };
    this.cur  = { x: me.x, y: me.y };
    this.err  = { x: this.err.x - dx, y: this.err.y - dy };
  }

  // Where to draw the character, `u` (0 to 1) of the way through the
  // current input step; dt fades the correction.
  //
  draw(u: number, dt: number): { x: number, y: number } {
    const k = Math.exp(-dt / EASE);
    this.err = { x: this.err.x * k, y: this.err.y * k };
    const t = Math.max(0, Math.min(1, u));
    return { x: this.prev.x + ((this.cur.x - this.prev.x) * t) + this.err.x,
             y: this.prev.y + ((this.cur.y - this.prev.y) * t) + this.err.y };
  }

  // A new level: nothing carries over.
  //
  reset(sim: Game, truth: World): void {
    this.sim     = sim;
    this.truth   = truth;
    this.me      = null;
    this.pending = [];
  }
}

// How far in the past (seconds of server time) others and the train are
// drawn: enough to have a state on each side despite uneven arrival.
//
export const DELAY = 0.1;

// A jump bigger than this many cells between two states is drawn at
// once, not slid through.
//
const JUMP = 2;

interface Snap {
  t       : number;
  players : Map<number, { x: number, y: number }>;
  train   : number;
}

export class Interp {
  snaps : Snap[];

  // The server time being drawn (-1 before any state).
  //
  t     : number;

  constructor() {
    this.snaps = [];
    this.t     = -1;
  }

  // A state arrived. Server time going back means a new level.
  //
  push(t: number, players: { id: number, x: number, y: number }[], train: number): void {
    const lastT = ( this.snaps.length ? this.snaps[this.snaps.length - 1].t : -Infinity );
    if (t < lastT) { this.reset(); }
    if (t === lastT) { return; }
    this.snaps.push({ t, players: new Map(players.map(p => [p.id, { x: p.x, y: p.y }])), train });
    while ( (this.snaps.length > 2) && (this.snaps[1].t < (t - 1)) ) { this.snaps.shift(); }
  }

  reset(): void {
    this.snaps = [];
    this.t     = -1;
  }

  // Move the drawn time on by dt, pulled gently toward DELAY behind the
  // newest state (a time constant of about a second), so it runs smoothly
  // whether states come early or late; far off, it jumps.
  //
  advance(dt: number): void {
    if (!this.snaps.length) { return; }
    const goal = this.snaps[this.snaps.length - 1].t - DELAY;
    if ( (this.t < 0) || (Math.abs(goal - this.t) > 0.5) ) { this.t = goal; return; }
    this.t += dt + ((goal - this.t) * Math.min(1, dt));
  }

  // The two states either side of the drawn time and how far between.
  //
  private around(): { a: Snap, b: Snap, u: number } | null {
    const s = this.snaps;
    if (!s.length) { return null; }
    if (this.t <= s[0].t) { return { a: s[0], b: s[0], u: 0 }; }
    for (let k = 0; k < (s.length - 1); k++) {
      if (this.t <= s[k + 1].t) { return { a: s[k], b: s[k + 1], u: (this.t - s[k].t) / (s[k + 1].t - s[k].t) }; }
    }
    return { a: s[s.length - 1], b: s[s.length - 1], u: 0 };
  }

  player(id: number): { x: number, y: number } | null {
    const r = this.around();
    if (!r) { return null; }
    const a = r.a.players.get(id), b = r.b.players.get(id);
    if ( !a || !b ) { return ( b ?? a ?? null ); }
    if (Math.hypot(b.x - a.x, b.y - a.y) > JUMP) { return b; }
    return { x: a.x + ((b.x - a.x) * r.u), y: a.y + ((b.y - a.y) * r.u) };
  }

  train(): number | null {
    const r = this.around();
    return ( r ? (r.a.train + ((r.b.train - r.a.train) * r.u)) : null );
  }
}

