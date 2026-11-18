// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Dynamite (D6.12): sticks made by the dynamite wagon, lit, put down or
// thrown along an arc that bounces, and the blast: trees and grey rock
// cleared, black rock, track and the train left, players caught killed.
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { World, Item } from "../src/sim/world.ts";
import { Cell, Grid } from "../src/level/cells.ts";
import { Game, NO_INPUT, Tool, TAP, type Settings, type Player, type Input } from "../src/sim/game.ts";
import { launch, stepBomb, flight, floorAt } from "../src/sim/dynamite.ts";
import { CONFIG } from "../src/config.ts";

// Map rows: . ground, S station, T forest, R grey rock, B black rock.
// Heights: optional rows of digits.
//
function world(rows: string[], heights?: string[]): World {
  const g = new Grid(rows[0].length, rows.length, Cell.GROUND),
        code: Record<string, number> = { ".": Cell.GROUND, "S": Cell.STATION, "T": Cell.TREE, "R": Cell.ROCK, "B": Cell.BLACKROCK };
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    g.set(x, y, code[ch] as never);
    if (heights) { g.setZ(x, y, Number(heights[y][x])); }
  }));
  return new World(g);
}

function settings(): Settings {
  return {
    rules   : { ...CONFIG.rules, C: 1, startTrack: 0 },
    train   : { ...CONFIG.train, startDelay: 1e9 },
    avatar  : { ...CONFIG.avatar },
    station : { ...CONFIG.station },
    tickHz  : 20,
  };
}

const MAP = [
  "....................",
  "....................",
  "..........TTTT......",
  "SSSSSS........SSSSSS",
  "...........RRB......",
  "....................",
  "....................",
];

function run(g: Game, seconds: number, inputs: Map<number, Input> = new Map()): void {
  for (let k = 0; k < Math.round(seconds * g.s.tickHz); k++) { g.tick(inputs); }
}

function at(p: Player, x: number, y: number, heading = 0): void { p.x = x; p.y = y; p.heading = heading; p.facing = 1; }

test("a thrown stick flies about its range on level ground and bounces off a wall", () => {
  const flat = world(MAP), r = CONFIG.rules.throwRange;
  for (const power of [0.5, 1]) {
    const path = flight(flat, launch(flat, 1, 2.5, 6.5, 0, power, r, 9), 0.05, 10), end = path.at(-1)!,
          ground = floorAt(flat, 2.5, 6.5);
    assert.ok( (end.x - 2.5) > (r * power * 0.8), "lands near its range, " + (end.x - 2.5).toFixed(2) );
    assert.ok( (end.x - 2.5) < (r * power * 1.6), "and slides only a little past it, " + (end.x - 2.5).toFixed(2) );
    assert.ok(Math.abs(end.z - ground) < 1e-9, "lies on the ground");
    assert.ok(Math.max(...path.map(q => q.z)) > (ground + 1), "flies in an arc");
  }

  // A wall of black rock six levels up at x = 8 (above the arc's top):
  // the stick comes back.
  //
  const H = ["00000000666600000000", "00000000666600000000", "00000000666600000000", "00000000000000000000",
             "00000000666600000000", "00000000666600000000", "00000000666600000000"];
  const walled = world(["....................", "....................", "....................", "SSSSSS........SSSSSS",
                        "........BBBB........", "........BBBB........", "........BBBB........"], H);
  const b = launch(walled, 1, 5.5, 5.5, 0, 1, r, 9);
  for (let k = 0; ( (k < 400) && !b.rest ); k++) { stepBomb(walled, b, 0.05); }
  assert.ok(b.rest);
  assert.ok(b.x < 8, "stopped by the wall, x " + b.x.toFixed(2));
});

test("the dynamite wagon takes wood and ore and makes sticks", () => {
  const w = world(MAP), s = settings(), g = new Game(w, s), p = g.addPlayer(1, "ann", "knight");
  g.train.cars = ["locomotive", "dynamite", "crafting"];
  g.shapeTrain();
  at(p, 2.5, 4.5);
  p.carry = Item.WOOD; p.count = 5;
  g.press(p);
  assert.deepEqual([g.train.dynWood, p.count], [s.rules.dynamiteWood, 5 - s.rules.dynamiteWood], "only what one stick needs");
  g.dropAll(p);
  p.carry = Item.ORE; p.count = s.rules.dynamiteOre;
  g.press(p);
  assert.deepEqual([g.train.dynOre, p.carry], [s.rules.dynamiteOre, Item.NONE]);
  for (let k = 0; k < Math.round((s.rules.dynamiteSeconds + 0.1) * s.tickHz); k++) { g.stepCrafting(); }
  assert.deepEqual([g.train.sticks, g.train.dynWood, g.train.dynOre, g.train.dynT], [1, 0, 0, -1]);
  g.press(p);
  assert.deepEqual([p.carry, p.count, p.fuse, g.train.sticks], [Item.DYNAMITE, 1, -1, 0]);

  // No tool while holding it; an unlit stick goes back into the wagon.
  //
  g.setTool(p, Tool.PICK);
  assert.deepEqual([p.tool, p.carry], [Tool.NONE, Item.DYNAMITE]);
  g.tick(new Map([[1, { ...NO_INPUT, action: true }]]));
  assert.deepEqual([p.carry, g.train.sticks, p.fuse], [Item.NONE, 1, -1]);
});

test("a lit stick put down or thrown clears trees and grey rock, not black rock, track or the train, and kills those near", () => {
  const w = world(MAP), s = settings(), g = new Game(w, s), a = g.addPlayer(1, "ann", "knight"), b = g.addPlayer(2, "bob", "robot");
  const press = (on: boolean) => new Map([[1, { ...NO_INPUT, action: on }]]);
  at(a, 12.5, 3.5, -Math.PI / 2);
  at(b, 2.5, 0.5);
  a.carry = Item.DYNAMITE; a.count = 1;

  // Press: lit. Press again and let go at once: put down at the feet.
  //
  g.tick(press(true));
  assert.ok(Math.abs(a.fuse - (s.rules.fuseSeconds - g.dt)) < 1e-9, "lit, burning from that tick");
  g.tick(press(false));
  g.tick(press(true));
  g.tick(press(false));
  assert.equal(g.bombs.length, 1);
  assert.ok(g.bombs[0].rest);
  assert.deepEqual([a.carry, a.fuse, a.aimT], [Item.NONE, -1, -1]);

  // Ann walks off; the blast on (12.5, 3.5) takes the trees north and
  // the grey rock south within the radius, each leaving one wood or one
  // ore, leaves the black rock, the track and a tree farther off, and
  // kills no one.
  //
  at(a, 2.5, 6.5);
  const track = w.idx(14, 3);
  w.layTrack(w.idx(13, 3), track);
  run(g, s.rules.fuseSeconds);
  assert.equal(g.bombs.length, 0);
  for (const [x, y, kind] of [[11, 2, Item.WOOD], [12, 2, Item.WOOD], [13, 2, Item.WOOD], [11, 4, Item.ORE], [12, 4, Item.ORE]]) {
    const i = w.idx(x, y);
    assert.deepEqual([w.type(i), w.stack[i], w.count[i]], [Cell.GROUND, kind, 1], x + "," + y + " cleared, its yield left");
  }
  assert.equal(w.stack[w.idx(13, 4)], Item.NONE);
  assert.equal(w.type(w.idx(13, 4)), Cell.BLACKROCK);
  assert.ok( w.track[w.idx(13, 3)] && w.track[track] );
  assert.equal(w.type(w.idx(10, 2)), Cell.TREE, "outside the radius");
  assert.deepEqual([a.dead, b.dead], [0, 0]);
  assert.ok(g.events.some(e => e.startsWith("boom:")));

  // Held too long, it goes off in the hand: Ann dies, Bob beside her too.
  //
  at(a, 5.5, 6.5); at(b, 6.2, 6.5);
  a.carry = Item.DYNAMITE; a.count = 1; a.fuse = -1;
  g.tick(press(true));
  run(g, s.rules.fuseSeconds + 0.1, press(true));
  assert.ok( (a.dead > 0) && (b.dead > 0) );
  assert.equal(a.carry, Item.NONE);
});

test("a long press throws the stick the way the character faces; a death drops a lit stick", () => {
  const w = world(MAP), s = settings(), g = new Game(w, s), a = g.addPlayer(1, "ann", "knight");
  const press = (on: boolean) => new Map([[1, { ...NO_INPUT, action: on }]]);
  at(a, 2.5, 6.5, 0);
  a.carry = Item.DYNAMITE; a.count = 1;
  g.tick(press(true));
  g.tick(press(false));
  g.tick(press(true));
  run(g, s.rules.throwHoldSeconds + TAP, press(true));
  g.tick(press(false));
  assert.equal(g.bombs.length, 1);
  const bomb = g.bombs[0];
  assert.ok( (bomb.vx > 0) && (bomb.vz > 0) && !bomb.rest );
  run(g, 2);
  assert.ok( (bomb.x - 2.5) > (s.rules.throwRange * 0.8), "thrown east about the full range, " + (bomb.x - 2.5).toFixed(2) );

  // Killed with a lit stick in hand: it lies where she was, still lit.
  //
  at(a, 4.5, 0.5);
  a.carry = Item.DYNAMITE; a.count = 1; a.fuse = 2;
  g.kill(a);
  assert.equal(a.carry, Item.NONE);
  assert.ok(g.bombs.some(q => ( (Math.abs(q.x - 4.5) < 1e-9) && (q.fuse === 2) )));
});
