// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Rules simulation tests on small hand-drawn maps.
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { Cell, Grid, DIRS } from "../src/level/cells.ts";
import { World, Item } from "../src/sim/world.ts";
import { Game, NO_INPUT, Tool, TOOL_NEXT, TOOL_PREV, LEAVE_RADIUS, WHEELBASE, CAR_BODY, BUMP_SECONDS, trainBody, type Input, type Settings, type Player } from "../src/sim/game.ts";
import { poseAt, carPose } from "../src/sim/path.ts";
import { CONFIG } from "../src/config.ts";
import { generate, DEFAULTS } from "../src/gen/generate.ts";

const N = 1 << 0, E = 1 << 1, S = 1 << 2, W = 1 << 3;

// Map rows: . ground, S station, T forest, R grey rock, ~ water,
// B black rock. Heights: optional rows of digits.
//
function world(rows: string[], heights?: string[]): World {
  const h = rows.length, w = rows[0].length, g = new Grid(w, h, Cell.GROUND);
  const code: Record<string, number> = { ".": Cell.GROUND, "S": Cell.STATION, "T": Cell.TREE, "R": Cell.ROCK, "~": Cell.WATER, "B": Cell.BLACKROCK };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      g.set(x, y, code[rows[y][x]] as never);
      if (heights) { g.setZ(x, y, Number(heights[y][x])); }
    }
  }
  return new World(g);
}

function settings(over: Partial<Settings["rules"]> = {}, train: Partial<Settings["train"]> = {}): Settings {
  return {
    rules  : { ...CONFIG.rules, C: 1, startTrack: 0, ...over },
    train  : { ...CONFIG.train, startDelay: 0, speed: 1, acceleration: 100, fastForward: 1, ...train },
    avatar  : { ...CONFIG.avatar },
    station : { ...CONFIG.station },
    tickHz  : 20,
  };
}

const FLAT = [
  "..................",
  "..................",
  "SSSSSS......SSSSSS",
  "..................",
  "..................",
];

// A game whose level timer never fires, for tests of other rules (the
// small test maps have few resources, so their real limit is tiny), with
// the start pad already used: the countdown is running.
//
function game(w: World, s: Settings): Game {
  const g = new Game(w, s);
  g.limit = Infinity;
  g.begin();
  return g;
}

function place(g: Game, p: Player, x: number, y: number, facing: number): void {
  p.x = x + 0.5; p.y = y + 0.5; p.level = g.w.z(g.w.idx(x, y)); p.facing = facing;
  p.heading = Math.atan2(DIRS[facing][1], DIRS[facing][0]);
}

function run(g: Game, seconds: number, inp: Map<number, Input> = new Map()): void {
  const n = Math.round(seconds * g.s.tickHz);
  for (let k = 0; k < n; k++) { g.tick(inp); }
}

test("track joins its neighbours and bends to fit (D6a.9)", () => {
  const w = world(FLAT), lineEnd = w.idx(5, 2);
  const t0 = w.idx(8, 4), t1 = w.idx(8, 3), t2 = w.idx(9, 3);
  w.layTrack(t0, lineEnd);
  w.layTrack(t1, lineEnd);
  assert.equal(w.conn[t1], S);
  w.layTrack(t2, lineEnd);
  assert.equal(w.conn[t1], (S | E), "t1 becomes a curve joining t0 and t2");
  assert.equal(w.conn[t2], W);
});

test("a new piece prefers the open end of the train's line (D6a.10)", () => {
  const w = world(FLAT), lineEnd = w.idx(5, 2);

  // A loose stub north of (6, 2) and the line end west of it: the line
  // end is joined first, then the straight-through option is preferred
  // over the stub when both are free.
  //
  w.layTrack(w.idx(6, 1), lineEnd);
  w.layTrack(w.idx(7, 2), lineEnd);
  w.layTrack(w.idx(6, 2), lineEnd);
  assert.equal(w.conn[w.idx(6, 2)], (W | E));
  assert.equal(w.conn[w.idx(6, 1)], 0, "the stub is left alone");
  assert.deepEqual(w.line().slice(-3), [w.idx(5, 2), w.idx(6, 2), w.idx(7, 2)]);
});

test("existing joints are never broken", () => {
  const w = world(FLAT), lineEnd = w.idx(5, 2);
  w.layTrack(w.idx(6, 2), lineEnd);
  w.layTrack(w.idx(7, 2), lineEnd);
  const before = w.conn[w.idx(6, 2)];
  w.layTrack(w.idx(6, 3), lineEnd);
  assert.equal(w.conn[w.idx(6, 2)], before);
});

test("crafting: 5 wood and 5 ore make 5C track in 5 s (D6a.5)", () => {
  const g = game(world(FLAT), settings({ C: 3, craftSecondsPerPair: 1, trackMax: 15 }, { startDelay: 1000 }));
  g.train.wood = 5; g.train.ore = 5;
  run(g, 4.9);
  assert.equal(g.train.track, 12);
  run(g, 0.15);
  assert.equal(g.train.track, 15);
  assert.equal(g.train.wood + g.train.ore, 0);
});

test("the crafting wagon holds at most trackMax pieces; carrying track beside it takes from it (D6a.30)", () => {
  const g = game(world(FLAT), settings({ C: 1, craftSecondsPerPair: 1, trackMax: 5, carryMax: 5 }, { startDelay: 1000 })),
        p = g.addPlayer(1, "a", "knight");
  g.train.wood = 8; g.train.ore = 8;
  run(g, 20);
  assert.deepEqual([g.train.track, g.train.wood, g.train.ore], [5, 3, 3], "crafting waits when full");

  // Track in hand, south of the crafting wagon (x 0-1 with the train at
  // the start station): it fills the hands like a ground pile; then
  // crafting resumes.
  //
  place(g, p, 1, 3, 0);
  p.carry = Item.TRACK; p.count = 2;
  g.tick(new Map());
  assert.deepEqual([p.count, g.train.track], [5, 2]);
  run(g, 3.1);
  assert.equal(g.train.track, 5);
});

test("a dying character drops what it carries as a leaving one does, and comes back near the train (D6a.31)", () => {
  const g = game(world(FLAT), settings({}, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");
  for (let x = 6; x < 10; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  g.train.p = 9.5;
  place(g, p, 11, 4, 0);
  p.carry = Item.ORE; p.count = 3;
  g.kill(p);
  assert.deepEqual([w.stack[w.idx(11, 4)], w.count[w.idx(11, 4)], p.carry, p.count], [Item.ORE, 3, Item.NONE, 0]);

  // A second death on a full cell: the next free cell takes it.
  //
  run(g, g.s.avatar.respawnSeconds + 0.1);
  place(g, p, 11, 4, 0);
  p.carry = Item.WOOD; p.count = 2;
  g.kill(p);
  const near = [w.idx(10, 4), w.idx(12, 4), w.idx(11, 3), w.idx(10, 3), w.idx(12, 3)];
  assert.ok(near.some(i => ( (w.stack[i] === Item.WOOD) && (w.count[i] === 2) )), "wood beside the ore");

  // Respawn: within three cells of a cell the train covers, off the track.
  //
  const seen = new Set<number>();
  for (let k = 0; k < 12; k++) {
    run(g, g.s.avatar.respawnSeconds + 0.1);
    assert.equal(p.dead <= 0, true);
    const c = g.cellOf(p), [x, y] = w.xy(c);
    assert.ok( (x >= 0) && (x <= 12) && (y >= 0) && (y <= 4) && !w.track[c], "near the train: " + x + "," + y );
    seen.add(c);
    g.kill(p);
  }
  assert.ok(seen.size > 3, "random spots: " + seen.size);
});

test("chopping takes hitsPerBlock hits of hitSeconds (D6a.8)", () => {
  const g = game(world(["..T....", ...FLAT.slice(1).map(r => r.slice(0, 7))].map((r, y) => ( (y === 2) ? "SS...SS" : r ))),
                     settings({ hitsPerBlock: 4, hitSeconds: 0.5 }, { startDelay: 1000 }));
  const p = g.addPlayer(1, "a", "knight"), hold = new Map([[1, { ...NO_INPUT, action: true }]]);
  place(g, p, 2, 1, 0);
  p.tool = Tool.AXE;
  run(g, 1.9, hold);
  assert.equal(g.w.type(g.w.idx(2, 0)), Cell.TREE);
  assert.equal(g.w.hits[g.w.idx(2, 0)], 3);
  run(g, 0.15, hold);
  assert.equal(g.w.type(g.w.idx(2, 0)), Cell.GROUND);
  assert.deepEqual([p.carry, p.count], [Item.NONE, 0], "hands hold the axe");
  assert.deepEqual([g.w.stack[g.w.idx(2, 0)], g.w.count[g.w.idx(2, 0)]], [Item.WOOD, 1], "the wood lands on the cell");
});

test("tools: only the matching tool hits, only no tool picks up; switching drops what is carried (D6a.20)", () => {
  const g = game(world(["..TR..............", ...FLAT.slice(1)]), settings({ hitsPerBlock: 1, hitSeconds: 0.05 }, { startDelay: 1000 })),
        w = g.w, p = g.addPlayer(1, "a", "knight"), hold = new Map([[1, { ...NO_INPUT, action: true }]]);
  const tool = (t: number) => { g.tick(new Map([[1, { ...NO_INPUT, tool: t }]])); };

  // No tool and the pickaxe do nothing to a tree; the axe chops it.
  //
  place(g, p, 2, 1, 0);
  run(g, 0.3, hold);
  assert.equal(w.type(w.idx(2, 0)), Cell.TREE, "no tool: no chopping");
  tool(Tool.PICK);
  run(g, 0.3, hold);
  assert.equal(w.type(w.idx(2, 0)), Cell.TREE, "the pickaxe does not chop");
  tool(TOOL_NEXT);
  assert.equal(p.tool, Tool.AXE, "next after the pickaxe is the axe");
  run(g, 0.3, hold);
  assert.equal(w.stack[w.idx(2, 0)], Item.WOOD);

  // With the axe, walking over and pressing on the wood picks nothing up.
  //
  place(g, p, 2, 0, 2);
  run(g, 0.2, hold);
  assert.equal(p.count, 0);
  tool(TOOL_NEXT);
  assert.equal(p.tool, Tool.NONE, "next after the axe is no tool");
  g.tick(new Map([[1, { ...NO_INPUT, action: true }]]));
  assert.deepEqual([p.carry, p.count], [Item.WOOD, 1], "no tool: picks the wood up");

  // Taking a tool while carrying puts the stack on the character's cell.
  //
  place(g, p, 6, 0, 2);
  p.lastCell = g.cellOf(p);
  tool(TOOL_PREV);
  assert.equal(p.tool, Tool.AXE, "previous before no tool is the axe");
  assert.deepEqual([p.count, w.stack[w.idx(6, 0)], w.count[w.idx(6, 0)]], [0, Item.WOOD, 1]);
});

test("taking a tool with nowhere to put the carried stack is refused (D6a.20)", () => {
  const g = game(world(["~~~~~", "~...~", "~~~~~", "SS.SS"]), settings({}, { startDelay: 1000 })),
        w = g.w, p = g.addPlayer(1, "a", "knight");

  // Every cell within one of the character holds track or another kind
  // of stack, or is water.
  //
  place(g, p, 2, 1, 1);
  p.lastCell = g.cellOf(p);
  p.carry = Item.ORE; p.count = 3;
  w.stack[w.idx(1, 1)] = Item.WOOD; w.count[w.idx(1, 1)] = 1;
  w.stack[w.idx(2, 1)] = Item.TRACK; w.count[w.idx(2, 1)] = 2;
  w.stack[w.idx(3, 1)] = Item.WOOD; w.count[w.idx(3, 1)] = 1;
  g.tick(new Map([[1, { ...NO_INPUT, tool: Tool.PICK }]]));
  assert.equal(p.tool, Tool.NONE, "switch refused");
  assert.equal(p.count, 3);
  assert.ok(p.denyT > 0, "refusal shown");
  run(g, CONFIG.avatar.denySeconds + 0.1);
  assert.equal(p.denyT, 0);

  // A neighbouring stack of the same kind takes it.
  //
  w.stack[w.idx(3, 1)] = Item.ORE; w.count[w.idx(3, 1)] = 1;
  g.tick(new Map([[1, { ...NO_INPUT, tool: Tool.PICK }]]));
  assert.equal(p.tool, Tool.PICK);
  assert.equal(w.count[w.idx(3, 1)], 4);
});

test("stacks: take up to the carry limit, walk-over pickup, one kind per cell (D6a.14)", () => {
  const g = game(world(FLAT), settings({ carryMax: 5 }, { startDelay: 1000 })),
        w = g.w, p = g.addPlayer(1, "a", "knight");
  const a = w.idx(8, 0), b = w.idx(9, 1);
  w.stack[a] = Item.WOOD; w.count[a] = 7;
  w.stack[b] = Item.WOOD; w.count[b] = 3;
  place(g, p, 8, 0, 0);
  g.press(p);
  assert.deepEqual([p.carry, p.count, w.count[a]], [Item.WOOD, 5, 2]);

  // Walk over the other wood stack while carrying wood: it is picked up
  // up to the limit.
  //
  p.count = 2;
  place(g, p, 8, 1, 1);
  run(g, 0.5, new Map([[1, { ...NO_INPUT, mx: 1 }]]));
  assert.deepEqual([p.carry, p.count], [Item.WOOD, 5]);
  assert.equal(w.count[b], 0);
  assert.equal(w.stack[b], Item.NONE);

  // A stack of another kind swaps.
  //
  const c = w.idx(10, 0);
  w.stack[c] = Item.ORE; w.count[c] = 2;
  place(g, p, 10, 0, 0);
  g.press(p);
  assert.deepEqual([p.carry, p.count, w.stack[c], w.count[c]], [Item.ORE, 2, Item.WOOD, 5]);

  // A stack of another kind too big to hold stays where it is
  // (2026-11-19).
  //
  const d = w.idx(11, 0);
  w.stack[d] = Item.WOOD; w.count[d] = 20;
  place(g, p, 11, 0, 0);
  g.press(p);
  assert.deepEqual([p.carry, p.count, w.stack[d], w.count[d]], [Item.ORE, 2, Item.WOOD, 20]);
});

test("the train derails at the end of its track (D6a.2)", () => {
  const g = game(world(FLAT), settings({}, { speed: 1 }));
  g.w.layTrack(g.w.idx(6, 2), g.lineEnd());
  g.line = g.w.line();
  run(g, 0.95);
  assert.equal(g.phase, "running");
  run(g, 0.2);
  assert.equal(g.phase, "derailed");
});

test("the train arrives when the track reaches the end station", () => {
  const g = game(world(FLAT), settings({}, { speed: 2 })), w = g.w;
  for (let x = 6; x < 12; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  assert.equal(g.line.length, 18);
  run(g, 10);
  assert.equal(g.phase, "arrived");
  assert.equal(g.train.p, 17.5);
});

test("track under or behind the train is fixed; track ahead can be picked up (D6a.11)", () => {
  const g = game(world(FLAT), settings({}, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");
  for (let x = 6; x < 9; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  place(g, p, 7, 2, 0);
  g.press(p);
  assert.deepEqual([p.carry, p.count], [Item.TRACK, 1]);
  assert.equal(w.track[w.idx(7, 2)], 0);
  assert.equal(g.line.length, 7, "the line now stops at (6, 2)");

  // Station track is never lifted.
  //
  place(g, p, 4, 2, 0);
  g.press(p);
  assert.equal(w.track[w.idx(4, 2)], 1);
});

test("with track in hand, line track is not lifted; loose track still is; empty hands lift line track (D6a.23)", () => {
  const g = game(world(FLAT), settings({}, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");
  for (let x = 6; x < 9; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  w.layTrack(w.idx(7, 4), g.lineEnd());
  g.line = w.line();
  assert.ok(!g.line.includes(w.idx(7, 4)), "(7, 4) is loose track");

  // On the line with track in hand: the piece stays.
  //
  place(g, p, 7, 2, 1);
  p.carry = Item.TRACK; p.count = 3;
  const n = g.line.length;
  g.press(p);
  assert.equal(w.track[w.idx(7, 2)], 1, "line track stays");
  assert.equal(g.line.length, n);
  assert.ok(p.count <= 3, "nothing picked up");

  // Loose track with track in hand: picked up.
  //
  place(g, p, 7, 4, 1);
  p.carry = Item.TRACK; p.count = 2;
  g.press(p);
  assert.equal(w.track[w.idx(7, 4)], 0);
  assert.equal(p.count, 3);

  // Empty hands on the line: lifted, as before (D6a.11).
  //
  place(g, p, 8, 2, 1);
  g.dropAll(p);
  g.press(p);
  assert.equal(w.track[w.idx(8, 2)], 0);
  assert.deepEqual([p.carry, p.count], [Item.TRACK, 1]);
});

test("standing on the line's open end with track, the faced cell beyond takes the next piece (D6a.24)", () => {
  const g = game(world(FLAT), settings({}, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");

  // Before any track: the start station's end works the same way.
  //
  const [sx, sy] = w.xy(g.lineEnd());
  place(g, p, sx, sy, 1);
  p.carry = Item.TRACK; p.count = 1;
  assert.equal(g.plan(p.x, p.y, p.facing, p.carry, p.count)?.cell, w.idx(sx + 1, sy), "from the station's end");
  g.dropAll(p);

  for (let x = 6; x < 9; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  const end = w.idx(8, 2);
  assert.equal(g.lineEnd(), end);

  // Facing on (east): the plan (which the ghost shows) is (9, 2), joined
  // back to the end; pressing lays it and the line grows.
  //
  place(g, p, 8, 2, 1);
  p.carry = Item.TRACK; p.count = 3;
  const pl = g.plan(p.x, p.y, p.facing, p.carry, p.count);
  assert.deepEqual([pl?.kind, pl?.cell], ["track", w.idx(9, 2)]);
  assert.ok( (pl!.conn & (1 << 3)) !== 0, "joins west, back to the end" );
  const n = g.line.length;
  g.press(p);
  assert.equal(w.track[w.idx(9, 2)], 1);
  assert.equal(g.line.length, n + 1);
  assert.equal(p.count, 2);

  // From the new end, facing north: a turn onto (9, 1).
  //
  place(g, p, 9, 2, 0);
  assert.equal(g.plan(p.x, p.y, p.facing, p.carry, p.count)?.cell, w.idx(9, 1));

  // Facing back along the line: nothing to place.
  //
  place(g, p, 9, 2, 3);
  assert.equal(g.plan(p.x, p.y, p.facing, p.carry, p.count), null);

  // Not on the end (middle of the line): nothing either.
  //
  place(g, p, 7, 2, 0);
  assert.equal(g.plan(p.x, p.y, p.facing, p.carry, p.count), null);
});

test("a stack where the next piece goes: one piece is laid and the stack taken; more pieces swap (D6a.27)", () => {
  const g = game(world(FLAT), settings({ carryMax: 5 }, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");
  for (let x = 6; x < 9; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  const t = w.idx(9, 2), stack = (kind: number, n: number) => { w.stack[t] = kind; w.count[t] = n; };

  // On the line end facing a wood stack, one piece in hand: the piece
  // extends the line and the wood comes into the hands.
  //
  stack(Item.WOOD, 3);
  place(g, p, 8, 2, 1);
  p.carry = Item.TRACK; p.count = 1;
  const pl = g.plan(p.x, p.y, p.facing, p.carry, p.count);
  assert.deepEqual([pl?.kind, pl?.cell, pl?.take], ["track", t, true], "the ghost shows the piece");
  g.press(p);
  assert.equal(w.track[t], 1);
  assert.equal(g.lineEnd(), t);
  assert.deepEqual([p.carry, p.count, w.stack[t]], [Item.WOOD, 3, Item.NONE]);

  // Several pieces facing an ore stack beyond the new end: they swap.
  //
  const u = w.idx(10, 2);
  w.stack[u] = Item.ORE; w.count[u] = 2;
  place(g, p, 9, 2, 1);
  p.carry = Item.TRACK; p.count = 4;
  assert.equal(g.plan(p.x, p.y, p.facing, p.carry, p.count)?.kind, "swap");
  g.press(p);
  assert.deepEqual([p.carry, p.count, w.stack[u], w.count[u], w.track[u]], [Item.ORE, 2, Item.TRACK, 4, 0]);

  // Standing on the stack next to the end works the same: one piece is
  // laid under the character, and a track pile there comes up too.
  //
  w.stack[u] = Item.TRACK; w.count[u] = 2;
  place(g, p, 10, 2, 0);
  p.carry = Item.TRACK; p.count = 1;
  g.press(p);
  assert.deepEqual([w.track[u], p.carry, p.count, w.stack[u]], [1, Item.TRACK, 2, Item.NONE]);

  // A stack too big to hold whole stays, with one piece or several in
  // hand (2026-11-19: it used to swap, past the carry limit).
  //
  const v = w.idx(11, 2);
  w.stack[v] = Item.WOOD; w.count[v] = 9;
  for (const n of [1, 3]) {
    place(g, p, 10, 2, 1);
    p.carry = Item.TRACK; p.count = n;
    assert.equal(g.plan(p.x, p.y, p.facing, p.carry, p.count), null, "no ghost with " + n + " in hand");
    g.press(p);
    assert.deepEqual([w.track[v], p.carry, p.count, w.stack[v], w.count[v]], [0, Item.TRACK, n, Item.WOOD, 9], n + " in hand");
  }
});

test("fast-forward: held by a player, or once the line reaches the end station (D6a.28)", () => {
  const g = game(world(FLAT), settings({}, { speed: 0.05, acceleration: 0.01, fastForward: 20 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");
  for (let x = 6; x < 10; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  place(g, p, 8, 4, 0);
  run(g, 10);
  assert.ok(Math.abs(g.train.v - 0.05) < 1e-9, "level speed");
  run(g, 2, new Map([[1, { ...NO_INPUT, fast: true }]]));
  assert.ok(g.train.fast);
  assert.ok(Math.abs(g.train.v - 1) < 1e-9, "20x within a second or two: " + g.train.v);
  run(g, 2);
  assert.ok( !g.train.fast && (Math.abs(g.train.v - 0.05) < 1e-9), "back to level speed on release: " + g.train.v );

  // The last pieces join the end station: fast without anyone holding.
  //
  for (let x = 10; x < 12; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  run(g, 2);
  assert.ok( g.train.fast && (g.train.v > 0.9), "joined: " + g.train.v );
  run(g, 30);
  assert.equal(g.phase, "arrived");
});

test("wagons work from all eight cells around them; the nearest wagon that can act does (D6a.29)", () => {
  const g = game(world(FLAT), settings({ carryMax: 5, storageMax: 12 }, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");
  for (let x = 6; x < 10; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  g.train.p = 9.5;
  g.train.track = 3; g.train.wood = 2;
  const xs = (car: number) => g.line.filter(i => (g.carAt(i) === car)).map(i => w.xy(i)[0]);
  assert.deepEqual([xs(2), xs(1)], [[4, 5], [6, 7]], "crafting wagon on x 4-5, storage on 6-7");

  // Diagonally off the crafting wagon's west end, facing away: track
  // comes up.
  //
  place(g, p, 3, 3, 2);
  g.press(p);
  assert.deepEqual([p.carry, p.count, g.train.track], [Item.TRACK, 3, 0]);

  // Nearest is the crafting wagon (north of it) but it is empty: the
  // storage wagon, diagonal, gives wood instead.
  //
  g.dropAll(p);
  place(g, p, 5, 1, 0);
  g.press(p);
  assert.deepEqual([p.carry, p.count, g.train.wood], [Item.WOOD, 2, 0]);

  // Wood in hand south of the crafting wagon, diagonal to the storage
  // wagon: the crafting wagon cannot take it, so it goes into storage.
  //
  place(g, p, 5, 3, 0);
  g.press(p);
  assert.deepEqual([p.carry, g.train.wood], [Item.NONE, 2]);

  // With track in the crafting wagon and both wagons equally near (on
  // the line between them), the nearer by the character's place wins.
  //
  g.train.track = 2;
  place(g, p, 5, 1, 0);
  p.x = 5.9;
  g.press(p);
  assert.deepEqual([p.carry, p.count], [Item.TRACK, 2], "crafting nearest: track, not wood");
});

test("a ramp may lead up to a tree or grey rock (D4.7)", () => {
  for (const top of ["T", "R"]) {
    const rows = ["........", "...." + top + "...", "........", "SS....SS"],
          hts  = ["00001000", "00001000", "00001000", "00000000"];
    const g = game(world(rows, hts), settings()), w = g.w, p = g.addPlayer(1, "a", "knight");
    place(g, p, 2, 1, 1);
    p.carry = Item.ORE; p.count = 1;
    const pl = g.plan(p.x, p.y, p.facing, p.carry, p.count);
    assert.deepEqual([pl?.kind, pl?.cell], ["ramp", w.idx(3, 1)], top + ": ramp below it");
  }
});

test("grey rock tops can be walked on; from a ridge a player mines down and builds a ramp back (D4.15)", () => {
  // A ridge (level 1) at x 0-1; below it a plateau (level 0) all grey
  // rock, whose tops are level with the ridge.
  //
  const g = game(world(["..RRRRRR", "..RRRRRR", "..RRRRRR", "........", "SS....SS"],
                       ["11000000", "11000000", "11000000", "11000000", "11000000"]),
                 settings({ hitsPerBlock: 2, hitSeconds: 0.1 }, { startDelay: 1000 })), w = g.w;
  const p = g.addPlayer(1, "a", "knight"), hold = new Map([[1, { ...NO_INPUT, action: true }]]);

  // From the ridge, east onto the rock tops, at the same height.
  //
  place(g, p, 1, 1, 1);
  run(g, 1.5, new Map([[1, { ...NO_INPUT, mx: 1 }]]));
  assert.ok(p.x > 4, "walked out over the rock: x = " + p.x);
  assert.equal(p.level, 1);
  assert.ok(!w.enterable(w.idx(3, 3), w.idx(3, 2), false), "from the ground below, rock is a wall");

  // On top of (3, 1), facing west: mine (2, 1), beside the ridge.
  //
  place(g, p, 3, 1, 3);
  p.level = 1;
  p.tool = Tool.PICK;
  run(g, 0.3, hold);
  assert.equal(w.type(w.idx(2, 1)), Cell.GROUND, "mined from on top");
  assert.equal(w.stack[w.idx(2, 1)], Item.ORE);

  // Walking off is stopped at the edge; a boost drops into the hole,
  // one level, survived.
  //
  p.tool = Tool.NONE;
  run(g, 0.5, new Map([[1, { ...NO_INPUT, mx: -1 }]]));
  assert.equal(p.level, 1, "the edge holds");
  p.boostCd = 0;
  g.tick(new Map([[1, { ...NO_INPUT, mx: -1, boost: true }]]));
  run(g, 0.4, new Map([[1, { ...NO_INPUT, mx: -1 }]]));
  assert.equal(w.xy(g.cellOf(p))[0], 2, "in the hole");
  assert.deepEqual([p.level, p.dead], [0, 0]);

  // Down there, rock is mined from beside its base as always; with ore
  // in hand, facing the ridge, a ramp goes on the hole; up it is the
  // ridge again.
  //
  // (The mined ore is picked up first, which clears the cell.)
  //
  w.stack[w.idx(2, 1)] = Item.NONE; w.count[w.idx(2, 1)] = 0;
  p.carry = Item.ORE; p.count = 1;
  place(g, p, 2, 1, 3);
  const pl = g.plan(p.x, p.y, p.facing, p.carry, p.count);
  assert.deepEqual([pl?.kind, pl?.cell], ["ramp", w.idx(2, 1)]);
  g.press(p);
  assert.ok(w.enterable(w.idx(2, 1), w.idx(1, 1), false), "the ramp leads up to the ridge");

  // Nothing is built from on top of rock.
  //
  place(g, p, 4, 1, 1);
  p.level = 1; p.carry = Item.TRACK; p.count = 2;
  assert.equal(g.plan(p.x, p.y, p.facing, p.carry, p.count), null);
});

test("cars rest on two wheel points: straight they follow the track, on a bend they cut the inside (D6a.26)", () => {
  const g = game(world(FLAT), settings({}, { startDelay: 1000 })), w = g.w;
  for (let x = 6; x < 9; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  for (let y = 3; y < 6; y++) { w.layTrack(w.idx(8, y), g.lineEnd()); g.line = w.line(); }
  const line = g.line, bend = line.indexOf(w.idx(8, 2));
  assert.ok(bend > 0);
  assert.ok(Math.abs(WHEELBASE - (CAR_BODY / 2)) < 1e-12, "wheels a quarter of the body in from each end");

  // Straight: the body's centre is on the track, heading along it.
  //
  const s = carPose(w, line, bend - 2, WHEELBASE), p = poseAt(w, line, bend - 2);
  assert.ok( (Math.hypot(s.x - p.x, s.y - p.y) < 1e-9) && (Math.abs(s.heading - p.heading) < 1e-9) );

  // Bend: the wheels are on the track, the centre inside the curve, and
  // the heading runs from the rear wheel to the front one.
  //
  const c = carPose(w, line, bend, WHEELBASE), m = poseAt(w, line, bend);
  for (const q of [c.front, c.rear]) { assert.ok(Math.abs(q.z) < 1e-9); }
  const corner = [8, 3];
  assert.ok(Math.hypot(c.x - corner[0], c.y - corner[1]) < Math.hypot(m.x - corner[0], m.y - corner[1]), "centre cuts the inside");
  assert.ok(Math.abs(c.heading - Math.atan2(c.front.y - c.rear.y, c.front.x - c.rear.x)) < 1e-12);

  // Collision circles lie on the straight body through that centre.
  //
  const pts = trainBody(w, line, bend + 1, 0.3).slice(0, 4);
  for (const q of pts) {
    const cross = ((q.x - pts[0].x) * Math.sin(pts[0].heading)) - ((q.y - pts[0].y) * Math.cos(pts[0].heading));
    assert.ok(Math.abs(cross) < 1e-9, "on one straight line");
  }
});

test("level timer ends the session (D6a.3)", () => {
  const g = new Game(world(["..TT", "..RR", "SSSS", "...."].map((r, y) => ( (y === 2) ? "S..S" : r ))), settings({ timerSlack: 1.5 }, { speed: 1, startDelay: 2 }));
  assert.equal(g.limit, 2 + (2 * 1.5));
  g.begin();
  g.phase = "running";
  g.stepTrain = () => {};
  run(g, 5.1);
  assert.equal(g.phase, "timeout");
});

test("the train pushes a character aside; one pinned against rock dies (D6a.16)", () => {
  const g = game(world(FLAT), settings({}, { speed: 1 })), w = g.w;
  for (let x = 6; x < 12; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  const p = g.addPlayer(1, "a", "knight");
  place(g, p, 7, 2, 0);
  p.y = 2.45;
  run(g, 3);
  assert.equal(p.dead, 0);
  assert.ok( (Math.abs(p.y - 2.5) > 0.5), "pushed off the track, y = " + p.y );

  // In a corridor the train shoves a character along ahead of it instead
  // of pinning it.
  //
  const walls = ["..................", "BBBBBBBBBBBBBBBBBB", "SSSSSS......SSSSSS", "BBBBBBBBBBBBBBBBBB", ".................."],
        wallH = ["000000000000000000", "111111111111111111", "000000000000000000", "111111111111111111", "000000000000000000"];
  const g2 = game(world(walls, wallH), settings({}, { speed: 1 }));
  for (let x = 6; x < 12; x++) { g2.w.layTrack(g2.w.idx(x, 2), g2.lineEnd()); g2.line = g2.w.line(); }
  const q = g2.addPlayer(1, "a", "knight");
  place(g2, q, 8, 2, 0);
  run(g2, 3);
  assert.equal(q.dead, 0, "shoved along, not killed");
  assert.ok(q.x > g2.train.p, "ahead of the train front (" + g2.train.p.toFixed(2) + "), x = " + q.x);

  // Boxed in by walls and a tree against the stopped train, a character
  // dies only after wedgeSeconds.
  //
  const box = walls.slice();
  box[2] = "SSSSSS.T....SSSSSS";
  const g3 = game(world(box, wallH), settings({}, { speed: 1 }));
  g3.w.layTrack(g3.w.idx(6, 2), g3.lineEnd());
  g3.line = g3.w.line();
  g3.phase = "derailed";
  g3.train.p = 7.0;
  const k = g3.addPlayer(1, "a", "knight");
  place(g3, k, 6, 2, 1);
  k.x = 6.75;
  run(g3, CONFIG.avatar.wedgeSeconds - 0.1);
  assert.equal(k.dead, 0, "not yet");
  run(g3, 0.6);
  assert.ok(g3.events.includes("died:1"), "pinned character dies");
});

test("bridges from a ledge and ramps against a face one level up (D4.7, D4.8)", () => {
  const g = game(world(["...~..", "......", "SS..SS", "......"], ["000000", "000011", "000000", "000000"]),
                     settings({ bridgeTrees: 2 }, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");
  place(g, p, 2, 0, 1);
  p.carry = Item.WOOD; p.count = 3;
  g.press(p);
  assert.equal(w.bridge[w.idx(3, 0)], 1);
  assert.deepEqual([p.carry, p.count], [Item.WOOD, 1]);
  assert.ok(g.events.includes("built:" + w.idx(3, 0)), "a built event (for its sound)");
  assert.ok(w.walkable(w.idx(3, 0)));

  place(g, p, 2, 1, 1);
  p.carry = Item.ORE; p.count = 1;
  g.press(p);
  assert.equal(w.type(w.idx(3, 1)), Cell.RAMP_GROUND);
  assert.equal(w.g.dir[w.idx(3, 1)], 1);
  assert.ok(w.joins(w.idx(3, 1), w.idx(4, 1)), "the ramp climbs to the higher cell");
  assert.ok(g.events.includes("built:" + w.idx(3, 1)));
});

test("only boosting into the train makes a bump event, at most one per BUMP_SECONDS", () => {
  const g = game(world(FLAT), settings({}, { startDelay: 1000 })), p = g.addPlayer(1, "a", "knight");
  g.shapeTrain();
  const t = g.trainPts[0], gap = g.s.train.collideRadius + g.s.avatar.radius + 0.02,
        bumps = () => g.events.filter(e => e.startsWith("bump:")),
        into  = (boostT: number) => { p.x = t.x; p.y = t.y + gap; p.boostT = boostT; g.events = []; g.move(p, 0, -0.1); };
  into(0);
  assert.deepEqual(bumps(), [], "walking into it");
  p.x = t.x; p.y = t.y + 0.1; p.boostT = 0;
  g.events = [];
  g.tick(new Map());
  assert.deepEqual(bumps(), [], "the train pushing");
  into(0.2);
  assert.deepEqual(bumps(), ["bump:1"], "boosting into it");
  into(0.2);
  assert.deepEqual(bumps(), [], "not again so soon");
});

test("the train blocks a character above it: no boosting off a ledge into it or across it (D6a.16)", () => {
  const hts = ["000000111111000000", "000000111111000000", "000000000000000000", "000000000000000000", "000000000000000000"];
  const g = game(world(FLAT, hts), settings({}, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");
  for (let x = 6; x < 10; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  g.train.p = 9.5;
  g.shapeTrain();
  place(g, p, 7, 1, 2);
  p.level = 1;
  g.tick(new Map([[1, { ...NO_INPUT, my: 1, boost: true }]]));
  run(g, 0.6, new Map([[1, { ...NO_INPUT, my: 1 }]]));
  assert.ok( (p.y < 2) && (p.level === 1) && (p.dead <= 0), "stays on the ledge: y = " + p.y.toFixed(2) + ", level " + p.level );
});

test("boosting over a one-level drop is survived, two levels kill (D4.9)", () => {
  const g = game(world(["......", "......", "SS..SS", "......"], ["100000", "200000", "000000", "000000"]),
                  settings({}, { startDelay: 1000 })),
        p = g.addPlayer(1, "a", "knight");
  place(g, p, 0, 0, 1);
  run(g, 1, new Map([[1, { ...NO_INPUT, mx: 1 }]]));
  assert.equal(p.level, 1, "a walk stops at the guard rail");
  g.tick(new Map([[1, { ...NO_INPUT, mx: 1, boost: true }]]));
  run(g, 0.5, new Map([[1, { ...NO_INPUT, mx: 1 }]]));
  assert.equal(p.level, 0);
  assert.equal(p.dead, 0);

  place(g, p, 0, 1, 1);
  p.boostCd = 0;
  g.tick(new Map([[1, { ...NO_INPUT, mx: 1, boost: true }]]));
  run(g, 0.5, new Map([[1, { ...NO_INPUT, mx: 1 }]]));
  assert.ok(g.events.includes("died:1"), "a drop of two levels kills");
});

test("heading follows the move at any angle; facing stays one of four; boost goes along the heading (D2.9)", () => {
  const g = game(world(["........", "........", "........", "........", "........", "SS....SS"]),
                  settings({}, { startDelay: 1000 })),
        p = g.addPlayer(1, "a", "knight");
  place(g, p, 3, 3, 1);
  const near = (a: number, b: number) => (Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9);

  // Keys: diagonals; a stick: any angle. Letting go keeps the heading.
  //
  g.tick(new Map([[1, { ...NO_INPUT, mx: 1, my: 1 }]]));
  assert.ok(near(p.heading, Math.PI / 4), "south-east on keys");
  g.tick(new Map([[1, { ...NO_INPUT, mx: -0.3, my: -0.8 }]]));
  assert.ok(near(p.heading, Math.atan2(-0.8, -0.3)), "a stick angle is kept as is");
  assert.equal(p.facing, 0, "facing is still one of four (north)");
  g.tick(new Map([[1, { ...NO_INPUT }]]));
  assert.ok(near(p.heading, Math.atan2(-0.8, -0.3)), "standing still keeps the heading");

  // Boost along a diagonal moves diagonally.
  //
  place(g, p, 1, 1, 1);
  g.tick(new Map([[1, { ...NO_INPUT, mx: 1, my: 1 }]]));
  const x0 = p.x, y0 = p.y;
  g.tick(new Map([[1, { ...NO_INPUT, mx: 1, my: 1, boost: true }]]));
  run(g, 0.2, new Map([[1, { ...NO_INPUT }]]));
  assert.ok( ((p.x - x0) > 0.2) && (Math.abs((p.x - x0) - (p.y - y0)) < 1e-6), "boost goes south-east: " + (p.x - x0) + ", " + (p.y - y0) );
});

test("a player who leaves drops what they carry, as near as there is room, else it is lost (D6a.22)", () => {
  const rows = ["...........", "...........", "...........", "...........", "...........", "...........", "...........",
                "...........", "...........", "...........", "SS.......SS"];
  const g = game(world(rows), settings({}, { startDelay: 1000 })), w = g.w;

  // Free cell under the player: the stack lands there.
  //
  let p = g.addPlayer(1, "a", "knight");
  place(g, p, 5, 5, 1); p.carry = Item.WOOD; p.count = 3;
  g.removePlayer(1);
  assert.equal(w.stack[w.idx(5, 5)], Item.WOOD); assert.equal(w.count[w.idx(5, 5)], 3);
  assert.ok(!g.players.has(1));

  // Same kind there already: it joins that stack.
  //
  p = g.addPlayer(2, "b", "knight");
  place(g, p, 5, 5, 1); p.carry = Item.WOOD; p.count = 2;
  g.removePlayer(2);
  assert.equal(w.count[w.idx(5, 5)], 5);

  // Own cell and the ring around it hold ore: it goes one ring further.
  //
  for (let dy = -1; dy <= 1; dy++) { for (let dx = -1; dx <= 1; dx++) { const i = w.idx(5 + dx, 5 + dy); w.stack[i] = Item.ORE; w.count[i] = 1; } }
  p = g.addPlayer(3, "c", "knight");
  place(g, p, 5, 5, 1); p.carry = Item.WOOD; p.count = 4;
  g.removePlayer(3);
  let found = -1;
  for (let i = 0; i < (w.w * w.h); i++) { if ( (w.stack[i] === Item.WOOD) && (w.count[i] === 4) ) { found = i; } }
  assert.ok(found >= 0, "the stack is placed");
  const [fx, fy] = w.xy(found);
  assert.equal(Math.max(Math.abs(fx - 5), Math.abs(fy - 5)), 2, "in the next ring out");

  // A dead player's stack drops where they died.
  //
  for (let dy = -2; dy <= 2; dy++) { for (let dx = -2; dx <= 2; dx++) { const i = w.idx(5 + dx, 5 + dy); w.stack[i] = Item.NONE; w.count[i] = 0; } }
  p = g.addPlayer(5, "e", "knight");
  place(g, p, 5, 5, 1); p.carry = Item.ORE; p.count = 2; p.dead = 1;
  g.removePlayer(5);
  assert.equal(w.stack[w.idx(5, 5)], Item.ORE, "dropped where they died");

  // Everything within range taken: the stack is lost, with an event.
  //
  for (let y = 0; y < w.h; y++) { for (let x = 0; x < w.w; x++) { const i = w.idx(x, y); w.stack[i] = Item.ORE; w.count[i] = 1; } }
  p = g.addPlayer(4, "d", "knight");
  place(g, p, 5, 5, 1); p.carry = Item.WOOD; p.count = 2;
  g.events.length = 0;
  g.removePlayer(4);
  assert.ok(g.events.includes("lost:4:2"), "lost only when nothing within " + LEAVE_RADIUS + " cells can take it");
});

test("a generated level loads and a character can walk from the station", () => {
  const lv = generate({ ...DEFAULTS, seed: 5 }),
        g  = new Game(new World(lv.grid), settings({}, { startDelay: 1000 })),
        p  = g.addPlayer(1, "a", "robot");
  assert.equal(g.w.start.length, DEFAULTS.stationLength);
  assert.equal(g.line.length, DEFAULTS.stationLength);
  const x0 = p.x;
  run(g, 1, new Map([[1, { ...NO_INPUT, mx: 1 }]]));
  assert.ok( (p.x !== x0) || (p.dead === 0) );
});

test("characters keep moving after the level ends", () => {
  const g = game(world(FLAT), settings()), p = g.addPlayer(1, "a", "knight");
  g.phase = "derailed";
  place(g, p, 8, 0, 1);
  run(g, 0.5, new Map([[1, { ...NO_INPUT, mx: 1 }]]));
  assert.ok(p.x > 9, "x = " + p.x);
});

test("the start pad starts the countdown; the train leaves after the delay (D6.9)", () => {
  const g = new Game(world(FLAT), settings({ startTrack: 5 }, { startDelay: 20 }));
  g.limit = Infinity;
  const p = g.addPlayer(1, "a", "knight");
  assert.equal(g.phase, "ready");
  const pile = [...g.w.stack.keys()].filter(i => (g.w.stack[i] === Item.TRACK));
  assert.equal(pile.length, 1, "one pile of starting track");
  assert.equal(g.w.count[pile[0]], 5);
  assert.equal(g.line.length, 6, "nothing laid yet");

  // Nobody on the pad: nothing happens, however long.
  //
  run(g, 30);
  assert.equal(g.phase, "ready");

  // Stepping off before the dwell time resets the fill.
  //
  p.x = g.pad.x; p.y = g.pad.y;
  run(g, 1);
  assert.ok( (g.pad.progress > 0.9) && (g.phase === "ready") );
  p.x = g.pad.x + 2;
  g.tick(new Map());
  assert.equal(g.pad.progress, 0);

  p.x = g.pad.x;
  run(g, CONFIG.station.dwellSeconds + 0.1);
  assert.equal(g.phase, "waiting");
  run(g, 19.8);
  assert.equal(g.phase, "waiting");
  run(g, 0.3);
  assert.notEqual(g.phase, "waiting");
});

test("walking: free on open ground, slides along walls, never jumps (D6a.16)", () => {
  const g = game(world(FLAT), settings()), p = g.addPlayer(1, "a", "knight"), sp = CONFIG.avatar.walkSpeed;
  place(g, p, 8, 0, 1);
  p.y = 0.5;
  const diag = new Map([[1, { ...NO_INPUT, mx: 0.7071, my: 0.7071 }]]);
  run(g, 0.5, diag);
  assert.ok( Math.abs(Math.hypot(p.x - 8.5, p.y - 0.5) - (sp * 0.5)) < 0.05, "diagonal walk on open ground at full speed" );

  // A black rock wall one level up along row 0: walking diagonally into
  // it slides along x and stays out of the wall.
  //
  const g2 = game(world(["BBBBBBBBBBBBBBBBBB", ...FLAT.slice(1)], ["111111111111111111", "000000000000000000", "000000000000000000", "000000000000000000", "000000000000000000"]), settings()),
        q  = g2.addPlayer(1, "a", "knight");
  place(g2, q, 3, 1, 1);
  run(g2, 1, new Map([[1, { ...NO_INPUT, mx: 0.7071, my: -0.7071 }]]));
  assert.ok(q.y >= (1 + CONFIG.avatar.radius - 1e-3), "kept out of the wall, y = " + q.y);
  assert.ok(q.x > 4.5, "slid along the wall, x = " + q.x);

  // Random walking on a generated level: no step longer than the walk
  // speed allows, and never standing in a cell that cannot be stood on.
  //
  const lv = generate({ ...DEFAULTS, seed: 3 }), g3 = game(new World(lv.grid), settings()), c = g3.addPlayer(1, "a", "robot");
  let mx = 1, my = 0, worst = 0;
  for (let k = 0; k < 4000; k++) {
    if ((k % 15) === 0) { const a = ((k * 2654435761) % 360) * (Math.PI / 180); mx = Math.cos(a); my = Math.sin(a); }
    const x0 = c.x, y0 = c.y, wasDead = (c.dead > 0), n0 = g3.events.length;
    g3.tick(new Map([[1, { ...NO_INPUT, mx, my }]]));
    if ( wasDead || (c.dead > 0) || g3.events.slice(n0).some(e => e.startsWith("died")) ) { continue; }
    worst = Math.max(worst, Math.hypot(c.x - x0, c.y - y0));
    assert.ok(g3.w.walkable(g3.cellOf(c)), "standing on an unwalkable cell at tick " + k);
  }
  assert.ok( (worst <= (((sp + CONFIG.avatar.pushSpeed) / 20) + 1e-3)), "largest step " + worst );
});

test("starting track is a pile beside the train's front, on the pad's side (D6.9)", () => {
  const g = game(world(FLAT), settings({ startTrack: 5, carryMax: 5 }, { startDelay: 1000 })), w = g.w,
        i = w.idx(5, 3);
  assert.deepEqual([w.stack[i], w.count[i]], [Item.TRACK, 5]);
  assert.ok(g.pad.y > 3, "pad on the same (south) side");

  // A player picks it up and lays a piece ahead of the train.
  //
  const p = g.addPlayer(1, "a", "knight");
  place(g, p, 5, 3, 0);
  g.press(p);
  assert.deepEqual([p.carry, p.count], [Item.TRACK, 5]);
  place(g, p, 6, 2, 1);
  g.press(p);
  assert.equal(g.line.length, 7);
  assert.equal(p.count, 4);
});

test("from a ramp, the tree or grey rock it leads up to can be chopped or mined (D4.7)", () => {
  for (const [top, tool, kind] of [["T", Tool.AXE, Item.WOOD], ["R", Tool.PICK, Item.ORE]] as const) {
    const rows = ["........", "...." + top + "...", "........", "SS....SS"],
          hts  = ["00001000", "00001000", "00001000", "00000000"];
    const g = game(world(rows, hts), settings({ hitsPerBlock: 2, hitSeconds: 0.5 })), w = g.w, p = g.addPlayer(1, "a", "knight");
    w.g.cells[w.idx(3, 1)] = Cell.RAMP_GROUND; w.g.dir[w.idx(3, 1)] = 1;
    place(g, p, 3, 1, 1);
    p.tool = tool;
    run(g, 1.2, new Map([[1, { ...NO_INPUT, action: true }]]));
    assert.equal(w.type(w.idx(4, 1)), Cell.GROUND, top + ": cleared from the ramp");
    assert.deepEqual([w.stack[w.idx(4, 1)], w.count[w.idx(4, 1)]], [kind, 1]);
  }
});

test("track on a ramp: the plan (the ghost) offers the ramp cell (D6a.18)", () => {
  const rows = ["..................", "..................", "SSSSSS............", "..................", "............SSSSSS"],
        hts  = ["000000000000000000", "000000000000000000", "000000000111111111", "000000000000000000", "000000000000000000"];
  const g = game(world(rows, hts), settings({}, { startDelay: 1000 })), w = g.w, p = g.addPlayer(1, "a", "knight");
  for (let x = 6; x < 8; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  w.g.cells[w.idx(8, 2)] = Cell.RAMP_GROUND; w.g.dir[w.idx(8, 2)] = 1;
  place(g, p, 7, 2, 1);
  p.carry = Item.TRACK; p.count = 2;
  const pl = g.plan(p.x, p.y, p.facing, p.carry, p.count);
  assert.deepEqual([pl?.kind, pl?.cell], ["track", w.idx(8, 2)]);
  g.press(p);
  assert.equal(w.track[w.idx(8, 2)], 1);
  assert.equal(g.lineEnd(), w.idx(8, 2));
});

test("empty hands with a stack underfoot and a wagon beside: the nearer wins, stack by its cell's centre, wagon by its cell's edge (D6a.32)", () => {
  const g = game(world(FLAT), settings({ carryMax: 5 }, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");
  for (let x = 6; x < 10; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  g.train.p = 9.5;
  const c = w.idx(5, 3);
  const setUp = (y: number) => {
    w.stack[c] = Item.ORE; w.count[c] = 2; g.train.track = 3; g.dropAll(p);
    place(g, p, 5, 3, 2);
    p.y = y;
  };

  // Middle of the cell (0 from its centre, 0.5 from the crafting wagon's
  // cell edge above): the ore.
  //
  setUp(3.5);
  g.press(p);
  assert.deepEqual([p.carry, g.train.track], [Item.ORE, 3]);

  // Up against the wagon (0.4 from the centre, 0.1 from its edge): track.
  //
  setUp(3.1);
  g.press(p);
  assert.deepEqual([p.carry, p.count, w.count[c]], [Item.TRACK, 3, 2]);
});

test("ramps: on one's own cell against a face, or over an edge; the plan matches the press (D6a.18)", () => {
  const H = ["000000", "000110", "000000", "000000"];
  const g = game(world(["......", "......", "SS..SS", "......"], H), settings({}, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");

  // Own cell: standing at (2, 1) facing east, (3, 1) is one level up.
  //
  place(g, p, 2, 1, 1);
  p.carry = Item.ORE; p.count = 2;
  const pl = g.plan(p.x, p.y, p.facing, p.carry, p.count);
  assert.deepEqual([pl?.kind, pl?.cell, pl?.dir], ["ramp", w.idx(2, 1), 1]);
  g.press(p);
  assert.equal(w.type(w.idx(2, 1)), Cell.RAMP_GROUND);
  assert.ok(w.joins(w.idx(2, 1), w.idx(3, 1)));

  // Over the edge: standing on top at (4, 1) facing east, (5, 1) is one
  // level down; the ramp goes there, rising back west.
  //
  place(g, p, 4, 1, 1);
  const pl2 = g.plan(p.x, p.y, p.facing, p.carry, p.count);
  assert.deepEqual([pl2?.kind, pl2?.cell, pl2?.dir], ["ramp", w.idx(5, 1), 3]);
  g.press(p);
  assert.equal(w.type(w.idx(5, 1)), Cell.RAMP_GROUND);
  assert.ok(w.joins(w.idx(5, 1), w.idx(4, 1)), "walk down from the top");
  assert.equal(p.count, 0);
});

test("carrying track, walking onto a loose piece picks it up; line track is left (D6a.18)", () => {
  const g = game(world(FLAT), settings({ carryMax: 5 }, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");
  w.layTrack(w.idx(9, 0), g.lineEnd());
  w.layTrack(w.idx(6, 2), g.lineEnd());
  g.line = w.line();
  p.carry = Item.TRACK; p.count = 1;
  place(g, p, 7, 0, 1);
  run(g, 1, new Map([[1, { ...NO_INPUT, mx: 1 }]]));
  assert.equal(w.track[w.idx(9, 0)], 0);
  assert.equal(p.count, 2);

  // Laying a loose piece where one stands does not pick it straight up.
  //
  place(g, p, 9, 4, 1);
  p.lastCell = g.cellOf(p);
  p.count = 1;
  g.press(p);
  run(g, 0.5);
  assert.equal(w.track[w.idx(9, 4)], 1);

  // A piece on the train's line is left alone.
  //
  place(g, p, 5, 3, 1);
  p.lastCell = -1;
  run(g, 0.5, new Map([[1, { ...NO_INPUT, mx: 0, my: -1 }]]));
  assert.equal(w.track[w.idx(6, 2)], 1);
});

test("walking into the train does not push through it (D6a.19)", () => {
  const g = game(world(FLAT), settings({}, { startDelay: 1000 })), p = g.addPlayer(1, "a", "knight");
  place(g, p, 3, 4, 0);
  run(g, 3, new Map([[1, { ...NO_INPUT, my: -1 }]]));
  assert.ok(p.y > 2.5 + 0.3, "stopped south of the train, y = " + p.y);
  assert.equal(p.dead, 0);
});

test("several track pieces put down away from the line make a pile; next to it, one is laid (D6a.19)", () => {
  const g = game(world(FLAT), settings({ carryMax: 5 }, { startDelay: 1000 })), w = g.w, p = g.addPlayer(1, "a", "knight");
  p.carry = Item.TRACK; p.count = 4;
  place(g, p, 9, 4, 0);
  p.lastCell = g.cellOf(p);
  assert.equal(g.plan(p.x, p.y, p.facing, p.carry, p.count)?.kind, "pile");
  g.press(p);
  assert.deepEqual([w.stack[w.idx(9, 4)], w.count[w.idx(9, 4)], w.track[w.idx(9, 4)], p.count], [Item.TRACK, 4, 0, 0]);

  p.carry = Item.TRACK; p.count = 4;
  place(g, p, 6, 2, 1);
  p.lastCell = g.cellOf(p);
  assert.equal(g.plan(p.x, p.y, p.facing, p.carry, p.count)?.kind, "track");
  g.press(p);
  assert.equal(g.line.length, 7);
  assert.equal(p.count, 3);
});

test("wood or ore dropped beside the storage wagon goes in, up to storageMax of each (D6a.25)", () => {
  const g = game(world(FLAT), settings({ carryMax: 10, storageMax: 6 }, { startDelay: 1000 })), w = g.w,
        p = g.addPlayer(1, "a", "knight");
  const t = g.line.find(i => (g.carAt(i) === 1))!, [x, y] = w.xy(t);

  // Beside the wagon, facing away from it: into the wagon.
  //
  place(g, p, x, y + 1, 2);
  p.carry = Item.WOOD; p.count = 4;
  g.press(p);
  assert.deepEqual([g.train.wood, p.count], [4, 0]);
  assert.equal(w.stack[w.idx(x, y + 1)], Item.NONE, "nothing on the ground");

  // Only 2 more wood fit: those go in, the rest stays in hand.
  //
  p.carry = Item.WOOD; p.count = 5;
  g.press(p);
  assert.deepEqual([g.train.wood, p.count, p.carry], [6, 3, Item.WOOD]);

  // Wood full: nothing goes in, so the wood goes down on the
  // character's own free cell (D6a.33), and more wood joins that stack.
  //
  const own = w.idx(x, y + 1);
  g.press(p);
  assert.deepEqual([g.train.wood, p.count, w.stack[own], w.count[own]], [6, 0, Item.WOOD, 3]);
  assert.equal(p.denyT, 0, "no refusal");
  p.carry = Item.WOOD; p.count = 2;
  g.press(p);
  assert.deepEqual([g.train.wood, p.count, w.count[own]], [6, 0, 5]);

  // With ore on the cell instead, there is nowhere for the wood: the
  // refusal shows and the wood stays in hand.
  //
  w.stack[own] = Item.ORE; w.count[own] = 1;
  p.carry = Item.WOOD; p.count = 3;
  g.press(p);
  assert.deepEqual([g.train.wood, p.count, w.stack[own], w.count[own]], [6, 3, Item.ORE, 1]);
  assert.ok(p.denyT > 0, "refused");
  w.stack[own] = Item.NONE; w.count[own] = 0;

  // The cap is per resource: with the wood full, ore still goes in, up
  // to its own 6.
  //
  const q = g.addPlayer(3, "c", "knight");
  place(g, q, x, y + 1, 2);
  q.carry = Item.ORE; q.count = 8;
  g.press(q);
  assert.deepEqual([g.train.wood, g.train.ore, q.count], [6, 6, 2]);
  g.train.ore = 0;
  g.dropAll(q);

  // Two cells away: an ordinary drop on the ground.
  //
  place(g, p, x, y + 2, 2);
  g.press(p);
  assert.deepEqual([w.stack[w.idx(x, y + 2)], w.count[w.idx(x, y + 2)]], [Item.WOOD, 3]);

  // Leaving beside the wagon: as much as fits goes in, the rest on the
  // ground.
  //
  g.train.wood = 4;
  const r = g.addPlayer(2, "b", "knight");
  place(g, r, x, y - 1, 0);
  r.carry = Item.WOOD; r.count = 5;
  g.removePlayer(2);
  assert.equal(g.train.wood, 6);
  assert.equal(w.count[w.idx(x, y - 1)], 3, "the rest beside");

  // The cap is read live, so an upgrade raises it.
  //
  g.s.rules.storageMax = 10;
  place(g, p, x, y + 1, 2);
  p.carry = Item.WOOD; p.count = 5;
  g.press(p);
  assert.equal(g.train.wood, 10);
});

test("empty hands take wood or ore back from the storage wagon (D6a.21)", () => {
  const g = game(world(FLAT), settings({ carryMax: 5, storageMax: 12 }, { startDelay: 1000 })), p = g.addPlayer(1, "a", "knight");
  g.train.wood = 7;

  // The storage wagon is the middle car; stand beside it facing it.
  //
  const t = g.line.find(i => (g.carAt(i) === 1))!, [x, y] = g.w.xy(t);
  place(g, p, x, y + 1, 0);
  g.press(p);
  assert.deepEqual([p.carry, p.count, g.train.wood], [Item.WOOD, 5, 2], "takes up to the carry limit");
  g.press(p);
  assert.deepEqual([p.count, g.train.wood], [0, 7], "carrying wood, a press puts it back");

  g.train.wood = 0; g.train.ore = 3;
  g.press(p);
  assert.deepEqual([p.carry, p.count, g.train.ore], [Item.ORE, 3, 0]);
  p.carry = Item.NONE; p.count = 0; p.tool = Tool.PICK;
  g.train.ore = 3;
  g.press(p);
  assert.equal(p.count, 0, "not with a tool out");
});

// D7.4: a tick takes a list of inputs per player and applies each in
// turn, so two inputs move twice as far as one; an idle input does not
// move the character or run its boost down.
//
test("a tick applies every input in a list; idle steps stand still (D7.4)", () => {
  const g = game(world(FLAT), settings()), p = g.addPlayer(1, "a", "knight"), q = g.addPlayer(2, "b", "knight");
  place(g, p, 8, 0, 1);
  place(g, q, 8, 4, 1);
  const go: Input = { ...NO_INPUT, mx: 1 };
  g.tick(new Map<number, Input | Input[]>([[1, go], [2, [go, go]]]));
  assert.ok(Math.abs((q.x - 8.5) - (2 * (p.x - 8.5))) < 1e-9, "two inputs, twice as far");
  q.boostT = 0.2;
  const x = q.x;
  g.tick(new Map<number, Input | Input[]>([[2, [{ ...NO_INPUT, idle: true }]]]));
  assert.deepEqual([q.x, q.boostT], [x, 0.2]);
});
