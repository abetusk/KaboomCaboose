// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The test run (src/gen/testrun.ts) and the development shortcuts
// (server/dev.ts, server --dev).
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { Item } from "../src/sim/world.ts";
import { Cell } from "../src/level/cells.ts";
import { NO_INPUT } from "../src/sim/game.ts";
import { Room, type Client } from "../server/room.ts";
import { Lag } from "../server/lag.ts";
import { TEST_PILE, TEST_PILES, TEST_GAP, testLength } from "../src/gen/testrun.ts";
import type { ServerMsg } from "../src/net/protocol.ts";

function client(id: number): Client & { got: ServerMsg[] } {
  const got = [] as ServerMsg[];
  return { ws: { readyState: 1, send: (t: string) => got.push(JSON.parse(t)) } as never, id, up: new Lag(0, 0), down: new Lag(0, 0),
           room: null, queue: [], held: { ...NO_INPUT }, ack: 0, got };
}

const OPTS = { name: "t", open: false, levels: 3, difficulty: "test", width: 10, length: 50 };

test("the test run: flat, grey rock along the top, trees along the bottom, track beside each station", () => {
  const r = new Room("TEST", OPTS, 1), w = r.game.w;
  assert.equal(w.segments, 3);
  const L = testLength(6);
  assert.equal(w.w, L + (2 * (L - 6 - 2)));
  assert.equal(r.info().length, L);
  for (let k = 0; k < (w.stations.length - 1); k++) {
    assert.equal(w.stations[k + 1][0][0] - w.stations[k].at(-1)![0] - 1, TEST_GAP, "cells of track between stations");
  }
  for (let x = 0; x < w.w; x++) {
    assert.equal(w.type(w.idx(x, 0)), Cell.ROCK);
    assert.equal(w.type(w.idx(x, w.h - 1)), Cell.TREE);
    for (let y = 1; y < (w.h - 1); y++) {
      const c = w.type(w.idx(x, y));
      assert.ok( (c === Cell.GROUND) || (c === Cell.STATION) );
      assert.equal(w.z(w.idx(x, y)), 0);
    }
  }
  for (const st of w.stations) {
    const [x, y] = st[st.length - 1];
    assert.deepEqual([w.stack[w.idx(x + 1, y - 1)], w.count[w.idx(x + 1, y - 1)]], [Item.TRACK, TEST_PILE]);
  }
  // Every station a level starts from has all its piles (the last
  // station's eastern ones would lie off the world's edge).
  //
  for (const st of w.stations.slice(0, -1)) {
    const [x, y] = st[st.length - 1];
    const n = [[1, -1], [2, -1]].filter(([dx, dy]) => ( (w.stack[w.idx(x + dx, y + dy)] === Item.TRACK) &&
                                                                       (w.count[w.idx(x + dx, y + dy)] === TEST_PILE) )).length;
    assert.equal(n, TEST_PILES);
  }
});

test("development shortcuts act only on a --dev server", () => {
  const r = new Room("TEST", OPTS, 1), a = client(1), said = () => a.got.filter(m => (m.t === "said")).map(m => (m as { text: string }).text);
  r.join(a, "ann");
  r.devCommand(a, "crash");
  assert.deepEqual([said(), r.game.phase], [[], "ready"], "ignored without --dev");

  r.dev = true;
  const g = r.game, p = g.players.get(1)!;
  r.devCommand(a, "arrive");
  assert.equal(g.phase, "arrived");
  assert.ok(g.line.includes(g.w.idx(g.w.end[0][0], g.w.end[0][1])), "track laid to the end station");
  assert.ok(g.offers.length > 0);
  r.devCommand(a, "offer:dynamiteWagon");
  assert.equal(g.offers[0].kind, "dynamiteWagon");
  r.devCommand(a, "stand:0");
  assert.deepEqual([p.x, p.y], [g.offers[0].x, g.offers[0].y]);
  r.devCommand(a, "give:lit");
  assert.ok( (p.carry === Item.DYNAMITE) && (p.fuse > 0) );
  r.devCommand(a, "give:crafting");
  assert.deepEqual([p.carry, p.count], [Item.WAGON_CRAFTING, 1]);
  r.devCommand(a, "wagon:dynamite");
  assert.equal(g.train.cars.at(-1), "dynamite");
  r.devCommand(a, "fill");
  assert.deepEqual([g.train.wood, g.train.track, g.train.sticks], [g.storageCap(), g.trackCap(), g.s.rules.dynamiteMax]);
  r.devCommand(a, "skip:3");
  assert.deepEqual([g.w.seg, g.phase], [2, "waiting"]);
  r.devCommand(a, "take:carry");
  assert.deepEqual([g.taken.carry, g.picked], [1, ""], "taken without counting as the station's pick");
  r.devCommand(a, "crash");
  assert.equal(g.phase, "derailed");
  r.devCommand(a, "nonsense");
  assert.match(said().at(-1)!, /^commands: /);
});
