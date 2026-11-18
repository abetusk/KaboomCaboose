// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Hiding network delay (D7.4, src/client/netsync.ts), without a browser:
// a server game and a client predictor over its own copy of the world,
// with made-up delay and jitter between them.
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { World, Item } from "../src/sim/world.ts";
import { Cell, Grid } from "../src/level/cells.ts";
import { Game, NO_INPUT, TOOL_NEXT, type Input, type Player, type Settings, type Train } from "../src/sim/game.ts";
import { CONFIG } from "../src/config.ts";
import { generate, DEFAULTS } from "../src/gen/generate.ts";
import { Predictor, Interp, DELAY } from "../src/client/netsync.ts";
import type { PlayerView } from "../src/net/protocol.ts";

// The start pad never fills, so the train stays put and only the
// player's own inputs change the game.
//
const S: Settings = { rules: CONFIG.rules, train: CONFIG.train, avatar: CONFIG.avatar, station: { ...CONFIG.station, dwellSeconds: 1e9 },
                      tickHz: 20 };

// A client's copy of the server's world, as the welcome message gives it.
//
function copyOf(w: World): World {
  const c = World.fromData(w.toData());
  for (let i = 0; i < (w.w * w.h); i++) { c.applyCell(w.cellState(i)); }
  return c;
}

function client(srv: Game): { pred: Predictor, truth: World } {
  const truth = copyOf(srv.w);
  return { pred: new Predictor(new Game(copyOf(srv.w), S, 1, false), truth), truth };
}

// Seeded random numbers, so a failure can be run again.
//
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ( ((t ^ (t >>> 14)) >>> 0) / 4294967296 );
  };
}

function view(p: Player, ack: number): PlayerView {
  return { id: p.id, name: p.name, character: p.character, x: p.x, y: p.y, level: p.level, facing: p.facing, heading: p.heading,
           carry: p.carry, count: p.count, hitting: p.hitting, boosting: (p.boostT > 0), dead: (p.dead > 0), emote: -1,
           tool: p.tool, denied: false, boostT: p.boostT, boostCd: p.boostCd, hitT: p.hitT, denyT: p.denyT, emoteT: p.emoteT,
           lastAction: p.lastAction, lastCell: p.lastCell, ack, fuse: p.fuse, aimT: p.aimT };
}

// One player wandering a generated level for `steps` input steps,
// walking, boosting, switching tools, and pressing or holding the
// action button, with `lat` ticks of delay each way plus 0 to `jit`
// more per message (order kept). The server applies inputs as
// server/main.ts does: the oldest each tick, more while over two wait
// (at most three), else an idle step. Returns the largest change of
// place the client had to make while the character was alive, whether
// the client ends in the server's state, and how many steps changed
// the drawn world (a pickup, a press, a hit) before the server had the
// input.
//
// A small level packed with trees, grey rock and piles of wood, ore and
// track, so a wanderer keeps chopping, mining, picking up and dropping.
//
function dense(seed: number): World {
  const rows = [
    "T.R.TT.R..T.R.T..R.TT.R.",
    ".T..R..T.R..T..R.T..R..T",
    "SSSSSS............SSSSSS",
    "..T.R..T..R.T..R..T.R..T",
    "R..T..R.T.T..R.T.R..T.R.",
    ".T.R.T..R..T.R..T..R.T..",
  ];
  const g = new Grid(rows[0].length, rows.length, Cell.GROUND), code: Record<string, number> = { ".": Cell.GROUND, "S": Cell.STATION, "T": Cell.TREE, "R": Cell.ROCK };
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { g.set(x, y, code[r[x]] as never); } });
  const w = new World(g), rnd = rng(seed + 99);
  for (let i = 0; i < (w.w * w.h); i++) {
    if ( (w.type(i) === Cell.GROUND) && (rnd() < 0.4) ) { w.stack[i] = 1 + Math.floor(rnd() * 3); w.count[i] = 1 + Math.floor(rnd() * 3); }
  }
  return w;
}

function wander(seed: number, steps: number, lat: number, jit: number, level: "generated" | "dense" = "generated"):
         { worst: number, gap: number, same: boolean, ahead: number, acted: number, kinds: Record<string, number> } {
  const srv = new Game(( (level === "dense") ? dense(seed) : new World(generate({ ...DEFAULTS, length: 100, seed }).grid) ), S, seed),
        p   = srv.addPlayer(1, "a", "knight"),
        { pred, truth } = client(srv),
        disp = pred.sim.w,
        rnd = rng(seed);
  srv.limit = Infinity;
  srv.w.changed.clear();

  const up   = [] as { at: number, seq: number, inp: Input }[],
        down = [] as { at: number, v: PlayerView, train: Train, cells: ReturnType<World["cellState"]>[] }[],
        q    = [] as { seq: number, inp: Input }[];
  let ack = 0, held: Input = { ...NO_INPUT }, upLast = 0, downLast = 0, worst = 0, ahead = 0, acted = 0,
      mx = 0, my = 0, action = false;
  const kinds: Record<string, number> = { hand: 0, tool: 0, hit: 0, cell: 0 };
  pred.reconcile(view(p, 0), srv.train);

  for (let k = 0; k < (steps + (4 * (lat + jit + 4))); k++) {

    // Client: take in states that have arrived, then step one input.
    //
    while ( down.length && (down[0].at <= k) ) {
      const d = down.shift()!, before = pred.me!;
      for (const c of d.cells) { truth.applyCell(c); }
      pred.reconcile(d.v, d.train);
      if ( (before.dead <= 0) && !d.v.dead && (pred.me!.dead <= 0) ) {
        worst = Math.max(worst, Math.hypot(pred.me!.x - before.x, pred.me!.y - before.y));
      }
    }
    if (k < steps) {
      if ((k % 10) === 0) { mx = (rnd() * 2) - 1; my = (rnd() * 2) - 1; }
      if ((k % 5) === 0)  { action = (rnd() < 0.5); }
      const inp: Input = { mx: ( action ? 0 : mx ), my: ( action ? 0 : my ), action, boost: (rnd() < 0.04), emote: -1,
                           tool: ( (rnd() < 0.05) ? TOOL_NEXT : -1 ), fast: false };
      const b = { ...pred.me! }, hits = [...disp.hits];
      disp.changed.clear();
      const seq = pred.step(inp), a = pred.me!;
      if ( (ack < seq) && (Math.hypot(a.x - b.x, a.y - b.y) > 0) ) { ahead++; }
      if (ack < seq) {
        const hand = ( (a.carry !== b.carry) || (a.count !== b.count) ), tool = (a.tool !== b.tool),
              hit  = disp.hits.some((h, i) => (h > hits[i])), cell = (disp.changed.size > 0);
        if (hand) { kinds.hand++; }
        if (tool) { kinds.tool++; }
        if (hit)  { kinds.hit++; }
        if (cell) { kinds.cell++; }
        if ( hand || tool || hit || cell ) { acted++; }
      }
      upLast = Math.max(upLast, k + lat + Math.floor(rnd() * (jit + 1)));
      up.push({ at: upLast, seq, inp });
    }

    // Server.
    //
    while ( up.length && (up[0].at <= k) ) { const u = up.shift()!; q.push({ seq: u.seq, inp: u.inp }); }
    const list = [] as Input[], take = () => { const e = q.shift()!; ack = e.seq; held = e.inp; list.push(e.inp); };
    if (q.length) { take(); }
    while ( (q.length > 2) && (list.length < 3) ) { take(); }
    if (!list.length) { list.push({ ...held, mx: 0, my: 0, boost: false, emote: -1, tool: -1, idle: true }); }
    srv.tick(new Map([[1, list]]));
    const cells = [...srv.w.changed].map(i => srv.w.cellState(i));
    srv.w.changed.clear();
    downLast = Math.max(downLast, k + lat + Math.floor(rnd() * (jit + 1)));
    down.push({ at: downLast, v: view(p, ack), train: { ...srv.train }, cells });
  }
  const me = pred.me!;
  let same = ( (me.carry === p.carry) && (me.count === p.count) && (me.tool === p.tool) );
  for (let i = 0; i < (srv.w.w * srv.w.h); i++) { same = ( same && disp.sameCell(srv.w, i) ); }
  return { worst, gap: Math.hypot(me.x - p.x, me.y - p.y), same, ahead, acted, kinds };
}

// With nothing else in the way, the client's own replay matches the
// server exactly, however late or unevenly its inputs arrive: no
// correction of place is ever needed, the client moves and acts before
// the server has seen the input, and it ends with the server's world.
//
test("own character: prediction matches the server under delay and jitter (D7.4)", () => {
  let acted = 0;
  const kinds: Record<string, number> = { hand: 0, tool: 0, hit: 0, cell: 0 };
  const runs = [[3, 0, 0], [5, 2, 0], [7, 2, 1], [11, 4, 3], [13, 6, 6], [17, 3, 2]].flatMap(r => [[...r, 0], [...r, 1]]);
  for (const [seed, lat, jit, d] of runs) {
    const level = ( d ? "dense" : "generated" ),
          r = wander(seed, ( d ? 3000 : 1500 ), lat, jit, level), tag = level + " seed " + seed + " lat " + lat + " jit " + jit + ": ";
    assert.ok(r.worst < 1e-9, tag + "correction " + r.worst);
    assert.ok(r.gap < 1e-9, tag + "ends " + r.gap + " from the server");
    assert.ok(r.same, tag + "drawn world or hands differ from the server's");
    if (lat > 0) {
      assert.ok(r.ahead > 100, tag + "moved ahead of the server " + r.ahead + " times");
      acted += r.acted;
      for (const k in kinds) { kinds[k] += r.kinds[k]; }
    }
  }
  for (const k in kinds) { assert.ok(kinds[k] > 50, k + " changes shown ahead of the server " + kinds[k] + " times"); }
});

// A pickup shows at once; when the server says otherwise (someone else
// took the stack first), the client follows the server.
//
test("own character: a pickup shows at once and the server can undo it (D7.4)", () => {
  const g = new Grid(8, 5, Cell.GROUND);
  for (let x = 0; x < 3; x++) { g.set(x, 2, Cell.STATION); g.set(x + 5, 2, Cell.STATION); }
  const srv = new Game(new World(g), S, 1), p = srv.addPlayer(1, "a", "knight"), c = srv.w.idx(4, 4);
  p.x = 4.5; p.y = 4.5; p.level = 0;
  srv.w.stack[c] = Item.WOOD; srv.w.count[c] = 3;
  const { pred, truth } = client(srv);
  pred.reconcile(view(p, 0), srv.train);

  const press = { ...NO_INPUT, action: true };
  pred.step(press);
  assert.deepEqual([pred.me!.carry, pred.me!.count, pred.sim.w.stack[c]], [Item.WOOD, 3, Item.NONE], "in hand at once");
  assert.equal(truth.stack[c], Item.WOOD, "the server's copy is untouched");

  // The server applied nothing yet and the stack has gone (taken by
  // someone else): replaying the press finds nothing to pick up.
  //
  truth.stack[c] = Item.NONE; truth.count[c] = 0;
  pred.reconcile(view(p, 0), srv.train);
  assert.deepEqual([pred.me!.carry, pred.me!.count], [Item.NONE, 0], "the server is the truth");
});

// A push the client could not foresee: what is drawn stays put at that
// moment and the difference fades within a few tenths of a second; a
// large jump (respawn) is shown at once.
//
test("own character: a correction fades, a respawn jumps (D7.4)", () => {
  const lv  = generate({ ...DEFAULTS, length: 100, seed: 3 }),
        srv = new Game(new World(lv.grid), S, 3),
        p   = srv.addPlayer(1, "a", "knight"),
        { pred } = client(srv);
  pred.reconcile(view(p, 0), srv.train);
  const d0 = pred.draw(1, 0);
  p.x += 0.3;
  pred.reconcile(view(p, 0), srv.train);
  const d1 = pred.draw(1, 0);
  assert.ok(Math.abs(d1.x - d0.x) < 1e-9, "no jump at the correction");
  let d = d1;
  for (let k = 0; k < 30; k++) { d = pred.draw(1, 1 / 60); }
  assert.ok(Math.abs(d.x - p.x) < 0.02, "faded to the server's place after 0.5 s: " + (d.x - p.x));

  p.x += 5;
  pred.reconcile(view(p, 0), srv.train);
  assert.ok(Math.abs(pred.draw(1, 0).x - p.x) < 1e-9, "a respawn-sized jump shows at once");
});

// Others and the train: states 50 ms apart in server time arrive 100 ms
// later plus 0 to 30 ms jitter (order kept); drawn at 72 frames a
// second, a character walking at a steady 3 cells a second never steps
// back and keeps close to its speed.
//
test("others and the train: drawn smoothly between uneven states (D7.4)", () => {
  const it = new Interp(), rnd = rng(1), speed = 3, arrive = [] as { at: number, t: number }[];
  let last = 0;
  for (let k = 0; k < 200; k++) {
    last = Math.max(last, (k * 0.05) + 0.1 + (rnd() * 0.03));
    arrive.push({ at: last, t: k * 0.05 });
  }
  const xs = [] as number[], lag = [] as number[];
  let newest = 0;
  for (let f = 0; f < (9 * 72); f++) {
    const now = f / 72;
    while ( arrive.length && (arrive[0].at <= now) ) {
      const a = arrive.shift()!;
      it.push(a.t, [{ id: 1, x: a.t * speed, y: 0 }], a.t * speed);
      newest = a.t;
    }
    it.advance(1 / 72);
    const p = it.player(1);
    if ( p && (now > 1) ) { xs.push(p.x); lag.push(newest - it.t); assert.equal(it.train(), p.x); }
  }
  const v = xs.slice(1).map((x, k) => ((x - xs[k]) * 72));
  assert.ok(Math.min(...v) >= 0, "never steps back");
  assert.ok( (Math.min(...v) > (speed * 0.8)) && (Math.max(...v) < (speed * 1.2)),
             "speed " + Math.min(...v).toFixed(2) + " to " + Math.max(...v).toFixed(2) );
  const mean = lag.reduce((a, b) => (a + b), 0) / lag.length;
  assert.ok( (Math.min(...lag) > 0) && (Math.abs(mean - DELAY) < 0.03),
             "drawn " + Math.min(...lag).toFixed(3) + " to " + Math.max(...lag).toFixed(3) + " s behind the newest state, mean " + mean.toFixed(3) );
});
