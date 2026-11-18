// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Runs of levels as one world (D6.4): playing level after level in it,
// generating it, and how a room ends a run (a crash or the last station
// sends everyone back to the lobby).
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { World, Item, LINE_BACK } from "../src/sim/world.ts";
import { Cell, Grid } from "../src/level/cells.ts";
import { Game, MAX_CARS, CAR_LEN, type Settings } from "../src/sim/game.ts";
import { CONFIG } from "../src/config.ts";
import { DEFAULTS } from "../src/gen/generate.ts";
import { generateRun, runWidth, runStep } from "../src/gen/run.ts";
import { analyze } from "../src/gen/analyze.ts";
import { Room, type Client } from "../server/room.ts";
import { Lag } from "../server/lag.ts";
import { NO_INPUT } from "../src/sim/game.ts";
import type { ServerMsg } from "../src/net/protocol.ts";
import { UPGRADES, OFFERS_PER_STATION, upgrade } from "../src/upgrades.ts";

function settings(): Settings {
  return {
    rules   : { ...CONFIG.rules, C: 1, startTrack: 0 },
    train   : { ...CONFIG.train, startDelay: 0, speed: 2, acceleration: 100, fastForward: 1 },
    avatar  : { ...CONFIG.avatar },
    station : { ...CONFIG.station },
    tickHz  : 20,
  };
}

// Three stations in a row, two levels; trees in the second level only.
//
const ROWS = [
  "..........................TT..",
  "..............................",
  "SSSSSS......SSSSSS......SSSSSS",
  "..............................",
  "..........................TT..",
];

function world(): World {
  const g = new Grid(ROWS[0].length, ROWS.length, Cell.GROUND), code: Record<string, number> = { ".": Cell.GROUND, "S": Cell.STATION, "T": Cell.TREE };
  ROWS.forEach((r, y) => [...r].forEach((ch, x) => g.set(x, y, code[ch] as never)));
  return new World(g);
}

function run(g: Game, seconds: number): void {
  for (let k = 0; k < Math.round(seconds * g.s.tickHz); k++) { g.tick(new Map()); }
}

test("a run plays level after level in one world, the train going on from where it stopped", () => {
  const w = world(), g = new Game(w, settings());
  assert.equal(w.segments, 2);
  assert.deepEqual([w.start[0], w.end[0]], [[0, 2], [12, 2]]);
  assert.equal(g.lastLevel(), false);

  // Level 1: track to the middle station, coming down into its west end
  // from the north (so that end joins north as well as east), arrive.
  //
  g.limit = Infinity;
  g.begin();
  const lay: [number, number][] = [[6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [10, 1], [11, 1], [12, 1]];
  for (const [x, y] of lay) { w.layTrack(w.idx(x, y), g.lineEnd()); g.line = w.line(); }
  assert.ok(g.line.includes(w.idx(17, 2)), "joined to the middle station");
  run(g, 15);
  assert.equal(g.phase, "arrived");
  const at = g.line[Math.floor(g.train.p)];
  assert.equal(at, w.idx(17, 2), "front at the middle station's east end");
  g.train.wood = 3;

  // Level 2: the middle station is the start; the train stands where it
  // stopped, its load kept, and the countdown to departure starts at
  // once (no start pad); the line runs east from there and not back
  // along level 1's track (which joins the station's west end).
  //
  g.nextSegment();
  assert.deepEqual([w.seg, g.phase, g.startT], [1, "waiting", g.time]);
  assert.deepEqual([w.start[0], w.end[0]], [[12, 2], [24, 2]]);
  // The line takes in LINE_BACK cells of level 1's track behind the
  // station first (room for a longer train), nearest last.
  //
  const back = [[4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [10, 1], [11, 1], [12, 1]].map(([x, y]) => w.idx(x, y));
  assert.equal(LINE_BACK, back.length);
  assert.deepEqual(g.line.slice(0, LINE_BACK), back);
  assert.equal(w.lineBack(g.line), LINE_BACK);
  assert.equal(g.line[LINE_BACK], w.idx(12, 2));
  assert.equal(g.line.length, LINE_BACK + 6);
  assert.equal(g.line[Math.floor(g.train.p)], at, "the train has not moved");
  assert.equal(g.train.wood, 3);
  assert.ok(Math.hypot(g.pad.x - 15, g.pad.y - 2.5) < 4, "start pad beside the middle station");
  assert.equal(g.levelLimit(), g.s.train.startDelay + ((4 / g.s.train.speed) * g.s.rules.timerSlack), "timer counts this level's trees only");
  g.limit = Infinity;
  g.begin();
  for (let x = 18; x < 24; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  run(g, 15);
  assert.equal(g.phase, "arrived");
  assert.equal(g.lastLevel(), true);
  g.nextSegment();
  assert.equal(w.seg, 1, "no level after the last");
});

test("a generated run joins its levels at shared stations", () => {
  const p = { ...DEFAULTS, ...(CONFIG.levelgen as object), C: CONFIG.rules.C, bridgeTrees: CONFIG.rules.bridgeTrees, length: 60, width: 12 };
  for (const seed of [1, 2, 3]) {
    const r = generateRun({ ...p, seed }, 4), w = new World(r.grid);
    assert.equal(r.grid.w, runWidth(p, 4));
    assert.deepEqual(r.offsets, [0, 1, 2, 3].map(k => k * runStep(p)));
    assert.equal(w.stations.length, 5);
    for (const st of w.stations) {
      assert.equal(st.length, p.stationLength);
      assert.equal(new Set(st.map(c => c[1])).size, 1, "a station lies on one row");
      assert.equal(new Set(st.map(c => r.grid.z(c[0], c[1]))).size, 1, "and on one height");
    }

    // Each level, as laid in the run, still has a track route its
    // resources can pay for.
    //
    for (const off of r.offsets) {
      const g = new Grid(p.length, p.width, Cell.GROUND);
      for (let y = 0; y < p.width; y++) {
        for (let x = 0; x < p.length; x++) {
          const i = (y * r.grid.w) + off + x, j = (y * p.length) + x;
          g.cells[j] = r.grid.cells[i]; g.height[j] = r.grid.height[i]; g.dir[j] = r.grid.dir[i];
        }
      }
      const a = analyze(g, { C: p.C, bridgeTrees: p.bridgeTrees });
      assert.ok(( a.cheapest && a.feasible && (a.ratio >= p.minRatio) ), "seed " + seed + " level at " + off);
    }
  }
});

// A stand-in client that keeps what it is sent.
//
function client(id: number): Client & { got: ServerMsg[] } {
  const got = [] as ServerMsg[];
  return { ws: { readyState: 1, send: (t: string) => got.push(JSON.parse(t)) } as never, id, up: new Lag(0, 0), down: new Lag(0, 0),
           room: null, queue: [], held: { ...NO_INPUT }, ack: 0, got };
}

test("a room moves on after arriving and ends the run after a crash or the last station", () => {
  const opts = { name: "t", open: true, levels: 2, difficulty: "moderate", width: 10, length: 50 };
  const r = new Room("TEST", opts, 7), a = client(1);
  r.cfg.station.countdownSeconds = 0;
  r.cfg.train.crashSeconds = 0;
  r.join(a, "ann");
  const welcome = a.got.find(m => (m.t === "welcome"))!;
  assert.ok( (welcome.t === "welcome") && (welcome.cells.length < 20), "only changed cells are sent" );
  if (welcome.t === "welcome") {
    const copy = World.fromData(welcome.level);
    for (const c of welcome.cells) { copy.applyCell(c); }
    for (let i = 0; i < (copy.w * copy.h); i++) { assert.ok(copy.sameCell(r.game.w, i)); }
  }

  r.game.phase = "arrived";
  r.tick();
  r.tick();
  assert.deepEqual([r.game.w.seg, r.game.phase, r.info().level], [1, "waiting", 2]);
  const st = a.got.filter(m => (m.t === "state")).at(-1)!;
  assert.ok( (st.t === "state") && (st.seg === 1) );

  r.game.phase = "arrived";
  r.tick();
  r.tick();
  const over = a.got.find(m => (m.t === "over"));
  assert.ok( over && (over.t === "over") && /Run complete/.test(over.text) );
  assert.deepEqual([r.closed, a.room, r.clients.size], [true, null, 0]);

  // A crash ends it too. The first room starts a new run instead of
  // closing.
  //
  const f = new Room("MAIN", opts, 9, true), b = client(2);
  f.cfg.train.crashSeconds = 0;
  f.join(b, "bob");
  const old = f.game;
  f.game.phase = "derailed";
  f.tick();
  f.tick();
  const o2 = b.got.find(m => (m.t === "over"));
  assert.ok( o2 && (o2.t === "over") && /Game over at level 1 of 2: derailed/.test(o2.text) );
  assert.deepEqual([f.closed, b.room], [false, null]);
  assert.notEqual(f.game, old);
  assert.deepEqual([f.game.phase, f.game.w.seg], ["ready", 0]);
});

// D6.7: station upgrades. Arriving at a station other than the last
// offers OFFERS_PER_STATION different upgrades in circles on free ground
// beside it; standing in one for the dwell time takes it, changing the
// settings the game runs on, and the others go. Upgrades taken their most
// are not offered; a new run takes them all back.
//
test("stations offer upgrades; standing in one takes it", () => {
  const w = world(), s = settings(), g = new Game(w, s), p = g.addPlayer(1, "ann", "knight");
  g.limit = Infinity;
  g.begin();
  for (let x = 6; x < 12; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  p.x = 3.5; p.y = 0.5;
  run(g, 15);
  assert.equal(g.phase, "arrived");
  assert.equal(g.offers.length, OFFERS_PER_STATION);
  assert.equal(new Set(g.offers.map(o => o.kind)).size, OFFERS_PER_STATION, "all different");
  for (const o of g.offers) {
    const i = w.idx(Math.floor(o.x), Math.floor(o.y));
    assert.ok( w.walkable(i) && !w.track[i] && (Math.abs(o.x - 15) <= 4) && (Math.abs(o.y - 2.5) <= 3.5), "beside the middle station" );
    assert.ok(g.offers.every(q => ( (q === o) || (Math.max(Math.abs(q.x - o.x), Math.abs(q.y - o.y)) >= 2) )), "apart");
  }

  // Not long enough: nothing taken, and stepping out empties the pie.
  //
  const o = g.offers[0], u = upgrade(o.kind)!, [sec, key, d] = u.changes[0],
        val = () => (s as unknown as Record<string, Record<string, number>>)[sec][key], before = val();
  p.x = o.x; p.y = o.y;
  run(g, s.station.dwellSeconds / 2);
  assert.ok(o.progress > 0);
  p.x = 3.5; p.y = 0.5;
  run(g, 0.1);
  assert.deepEqual([o.progress, g.picked], [0, ""]);
  p.x = o.x; p.y = o.y;
  run(g, s.station.dwellSeconds + 0.1);
  assert.deepEqual([g.picked, g.taken[o.kind], g.offers.length], [o.kind, 1, 0]);
  assert.equal(val(), before + d);
  assert.deepEqual(g.tuned[0], [sec, key, before + d]);

  // At the last station: no offers.
  //
  g.nextSegment();
  assert.deepEqual([g.offers.length, g.picked], [0, ""]);
  g.limit = Infinity;
  g.begin();
  for (let x = 18; x < 24; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  p.x = 3.5; p.y = 0.5;
  run(g, 15);
  assert.deepEqual([g.phase, g.offers.length], ["arrived", 0]);

  // Only upgrades with room left are drawn.
  //
  for (const e of UPGRADES.slice(2)) { g.taken[e.kind] = e.max; }
  g.offer();
  assert.deepEqual(g.offers.map(q => q.kind).sort(), UPGRADES.slice(0, 2).map(e => e.kind).sort());

  // Taking them back restores every setting.
  //
  for (const e of UPGRADES.slice(2)) { g.taken[e.kind] = 0; }
  g.undoUpgrades();
  assert.equal(val(), before);
  assert.deepEqual(g.taken, {});
});

test("a room tells its players a picked upgrade and moves on at once", () => {
  const r = new Room("TEST", { name: "t", open: true, levels: 3, difficulty: "moderate", width: 10, length: 50 }, 11), a = client(1);
  r.join(a, "ann");
  const g = r.game, p = g.players.get(1)!;
  g.phase = "arrived";
  g.offer();
  assert.equal(g.offers.length, OFFERS_PER_STATION);
  const o = g.offers[0], [sec, key, d] = upgrade(o.kind)!.changes[0],
        was = (r.cfg[sec] as Record<string, number>)[key];
  p.x = o.x; p.y = o.y;
  for (let k = 0; ( (k < (Math.ceil((r.cfg.station.dwellSeconds as number) * 20) + 2)) && (g.w.seg === 0) ); k++) { r.tick(); }
  assert.equal((r.cfg[sec] as Record<string, number>)[key], was + d, "the room's settings changed");
  assert.ok(a.got.some(m => ( (m.t === "config") && (m.section === sec) && (m.key === key) && (m.value === (was + d)) )), "player told");
  const st = a.got.filter(m => ( (m.t === "state") && (m.picked === o.kind) )).at(-1)!;
  assert.ok( (st.t === "state") && (st.offers.length === 0) && (st.taken[o.kind] === 1), "the pick and the count taken are sent" );

  // The next level starts with no wait: the station countdown is cut at
  // the pick, and the train's countdown starts without the start pad.
  //
  assert.deepEqual([g.w.seg, g.phase, g.taken[o.kind]], [1, "waiting", 1]);

  // A new run starts from the room's settings without the upgrade.
  //
  r.restart();
  assert.equal((r.cfg[sec] as Record<string, number>)[key], was);
});

// D6.7: a wagon won at a station joins the back of the train at once.
// With no room for it, it lies where its offer stood; a player carries
// such a wagon (one at a time) to the back of the train and presses
// action beside the last car to add it. Each storage wagon adds storageMax of
// each resource; each crafting wagon adds trackMax and makes a pair
// alongside the others. At most MAX_CARS cars; the next level's line
// takes in enough of the track behind the station for a longer train.
//
test("a won wagon joins the train, or is carried to it", () => {
  const w = world(), s = settings(), g = new Game(w, s), p = g.addPlayer(1, "ann", "knight");
  g.limit = Infinity;
  g.begin();
  for (let x = 6; x < 12; x++) { w.layTrack(w.idx(x, 2), g.lineEnd()); g.line = w.line(); }
  p.x = 3.5; p.y = 0.5;
  run(g, 15);
  assert.equal(g.phase, "arrived");
  g.offers = [];
  g.take("storageWagon", { x: 15.5, y: 4.5 });
  assert.deepEqual(g.train.cars, ["locomotive", "storage", "crafting", "storage"], "joins at once");
  s.train.speedPerWagon = 0.02;
  assert.ok(Math.abs(g.levelSpeed() - (s.train.speed + 0.02)) < 1e-12, "each won wagon adds train.speedPerWagon");
  assert.equal(g.carAt(w.line()[Math.floor(g.train.p) - 7]), 3, "behind the others");
  assert.equal(w.stack[w.idx(15, 4)], Item.NONE, "nothing left on the ground");

  // A full train: no wagon is offered, and one taken anyway lies where
  // its offer stood.
  //
  g.train.cars = ["locomotive", "storage", "crafting", "storage", "crafting", "storage", "crafting"];
  for (let k = 0; k < 20; k++) {
    g.offer();
    assert.ok(g.offers.every(o => !upgrade(o.kind)!.wagon), "no wagon offered to a full train");
  }
  g.offers = [];
  g.take("storageWagon", { x: 15.5, y: 4.5 });
  assert.equal(g.train.cars.length, MAX_CARS);
  assert.deepEqual([w.stack[w.idx(15, 4)], w.count[w.idx(15, 4)]], [Item.WAGON_STORAGE, 1]);
  g.train.cars = ["locomotive", "storage", "crafting"];
  g.shapeTrain();
  w.stack[w.idx(14, 4)] = Item.WAGON_STORAGE; w.count[w.idx(14, 4)] = 1;

  // Picked up with empty hands; a second one is not taken on top.
  //
  p.x = 15.5; p.y = 4.5;
  g.press(p);
  assert.deepEqual([p.carry, p.count], [Item.WAGON_STORAGE, 1]);
  p.x = 14.5; p.y = 4.5;
  g.tick(new Map());
  assert.deepEqual([p.count, w.count[w.idx(14, 4)]], [1, 1], "one wagon at a time");

  // Beside the last car (the crafting wagon, cells 12-13): it joins.
  //
  p.x = 12.5; p.y = 3.5;
  g.press(p);
  assert.deepEqual(g.train.cars, ["locomotive", "storage", "crafting", "storage"]);
  assert.deepEqual([p.carry, p.count], [Item.NONE, 0]);
  assert.equal(g.storageCap(), 2 * s.rules.storageMax);
  assert.equal(g.carAt(w.line()[Math.floor(g.train.p) - 7]), 3, "the new car stands behind the others");

  // More wood than one wagon holds goes in.
  //
  g.train.wood = 0;
  p.carry = Item.WOOD; p.count = s.rules.storageMax + 1;
  s.rules.carryMax = Math.max(s.rules.carryMax, p.count);
  p.x = 12.5; p.y = 1.5;
  g.press(p);
  assert.equal(g.train.wood, s.rules.storageMax + 1);

  // Up to MAX_CARS cars, then a refusal.
  //
  g.train.cars = ["locomotive", "storage", "crafting", "storage", "crafting", "storage", "crafting"];
  assert.equal(g.train.cars.length, MAX_CARS);
  p.carry = Item.WAGON_CRAFTING; p.count = 1;
  p.x = 6.5; p.y = 3.5;
  g.press(p);
  assert.equal(g.train.cars.length, MAX_CARS);
  assert.ok(p.denyT > 0);

  // Two crafting wagons make two pairs at once.
  //
  g.train.cars = ["locomotive", "storage", "crafting", "crafting"];
  g.train.track = 0; g.train.wood = 2; g.train.ore = 2; g.train.crafts = [];
  for (let k = 0; k < Math.round((s.rules.craftSecondsPerPair + 0.1) * s.tickHz); k++) { g.stepCrafting(); }
  assert.deepEqual([g.train.track, g.train.wood, g.train.ore], [2 * s.rules.C, 0, 0]);
  assert.equal(g.trackCap(), 2 * s.rules.trackMax);

  // The next level: the four-car train stands on track, its last car on
  // level 1's track behind the station.
  //
  g.nextSegment();
  const tail = g.train.p - (g.train.cars.length * CAR_LEN);
  assert.ok(tail >= -0.5, "the last car's back is on the line");
  assert.ok(w.lineBack(g.line) > 0);
});
