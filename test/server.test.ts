// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Server test, headless: start it on a free local port, fetch the page
// and a module, join over the WebSocket, move, and stop it.
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "../vendor/ws/wrapper.mjs";
import { startServer } from "../server/main.ts";
import { Lag } from "../server/lag.ts";
import { Room } from "../server/room.ts";
import { World } from "../src/sim/world.ts";
import { Game } from "../src/sim/game.ts";
import { Predictor } from "../src/client/netsync.ts";
import { CONFIG } from "../src/config.ts";
import type { ServerMsg } from "../src/net/protocol.ts";

test("server serves the client and runs a game over the WebSocket", async () => {
  const srv = await startServer(0, "127.0.0.1", true);
  try {
    const base = "http://127.0.0.1:" + srv.port;
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /importmap/);
    const mod = await fetch(base + "/src/sim/game.js");
    assert.equal(mod.status, 200);
    assert.match(mod.headers.get("content-type") ?? "", /javascript/);
    assert.doesNotMatch(await mod.text(), /from "[^"]+\.ts"/);
    assert.equal((await fetch(base + "/../package.json")).status, 404);

    const ws = new WebSocket("ws://127.0.0.1:" + srv.port + "/ws"),
          msgs = [] as ServerMsg[];
    ws.on("message", (d: unknown) => { msgs.push(JSON.parse(String(d))); });
    await new Promise<void>(ok => ws.on("open", () => ok()));
    ws.send(JSON.stringify({ t: "hello", name: "tester" }));
    const wait = (ms: number) => new Promise(ok => setTimeout(ok, ms));
    await wait(300);

    const welcome = msgs.find(m => (m.t === "welcome"));
    assert.ok(welcome, "welcome received");
    const states = () => msgs.filter((m): m is Extract<ServerMsg, { t: "state" }> => (m.t === "state"));
    const me = () => states().at(-1)!.players.find(p => (p.name === "tester"))!;
    assert.ok(me(), "player is in the game");
    const x0 = me().x, y0 = me().y;

    // Walk east, then west, for half a second each: the character moves
    // unless it is boxed in both ways.
    //
    for (let k = 0; k < 10; k++) { ws.send(JSON.stringify({ t: "input", mx: 1, my: 0, action: false, boost: false, emote: -1 })); await wait(50); }
    const x1 = me().x;
    for (let k = 0; k < 10; k++) { ws.send(JSON.stringify({ t: "input", mx: -1, my: 0, action: false, boost: false, emote: 2 })); await wait(50); }
    const x2 = me().x;
    assert.ok( (x1 !== x0) || (x2 !== x0) || (me().y !== y0), "character moved" );
    assert.ok(states().some(s => s.events.some(e => e.startsWith("emote:"))), "emote sent once arrives");

    // Settings: a valid change is applied to the room and announced; a
    // wrong type or unknown key is ignored. The file's settings stay as
    // they are (each room has a copy). Restart sends a new level.
    //
    assert.equal((welcome as Extract<ServerMsg, { t: "welcome" }>).config.rules.carryMax, CONFIG.rules.carryMax);
    const before = CONFIG.rules.carryMax;
    ws.send(JSON.stringify({ t: "set", section: "rules", key: "carryMax", value: before + 2 }));
    ws.send(JSON.stringify({ t: "set", section: "rules", key: "carryMax", value: "lots" }));
    ws.send(JSON.stringify({ t: "set", section: "rules", key: "nonsense", value: 3 }));
    ws.send(JSON.stringify({ t: "set", section: "input", key: "deadzone", value: 0.5 }));
    await wait(200);
    assert.equal(CONFIG.rules.carryMax, before);
    assert.ok(msgs.some(m => ( (m.t === "config") && (m.key === "carryMax") && (m.value === (before + 2)) )));
    assert.equal(msgs.filter(m => (m.t === "config")).length, 1);
    const nw = msgs.filter(m => (m.t === "welcome")).length;
    ws.send(JSON.stringify({ t: "restart" }));
    await wait(1500);
    assert.equal(msgs.filter(m => (m.t === "welcome")).length, nw + 1, "restart sends a new level");
    ws.close();
  }
  finally {
    srv.close();
  }
});

// D7.7: a Lag holds each message for its latency plus up to its jitter
// and lets them out in order; at 0 they pass at once.
//
test("made-up delay holds messages and keeps their order", async () => {
  const now = new Lag(0, 0), got = [] as number[];
  now.run(() => got.push(0));
  assert.deepEqual(got, [0], "no delay: at once");

  const t0 = performance.now(), times = [] as number[], order = [] as number[],
        lag = new Lag(60, 80);
  for (let k = 0; k < 20; k++) { lag.run(() => { order.push(k); times.push(performance.now() - t0); }); }
  await new Promise(ok => setTimeout(ok, 250));
  assert.deepEqual(order, [...Array(20).keys()], "in order");
  assert.ok(times.every(t => (t >= 59)), "none before the latency");
  assert.ok(times.every(t => (t <= 200)), "none long after latency + jitter");

  const gone = new Lag(30, 0), late = [] as number[];
  gone.run(() => late.push(1));
  gone.clear();
  await new Promise(ok => setTimeout(ok, 60));
  assert.deepEqual(late, [], "cleared: dropped");
});

// With --latency 100, hello to welcome is a round trip: at least 200 ms.
//
test("server --latency delays both ways", async () => {
  const srv = await startServer(0, "127.0.0.1", false, { latency: 100, jitter: 0 });
  try {
    const ws = new WebSocket("ws://127.0.0.1:" + srv.port + "/ws");
    await new Promise<void>(ok => ws.on("open", () => ok()));
    const t0 = performance.now(),
          dt = await new Promise<number>(ok => {
            ws.on("message", (d: unknown) => { if (JSON.parse(String(d)).t === "welcome") { ok(performance.now() - t0); } });
            ws.send(JSON.stringify({ t: "hello", name: "slow" }));
          });
    assert.ok(dt >= 199, "round trip " + dt.toFixed(0) + " ms");
    assert.ok(dt < 600, "round trip " + dt.toFixed(0) + " ms");
    ws.close();
  }
  finally {
    srv.close();
  }
});

// D7.4: numbered inputs are each applied once; a burst is worked off
// (more than one a tick while a backlog waits) and the state reports
// the last applied as the player's ack.
//
test("server applies numbered inputs once each and reports the ack", async () => {
  const srv = await startServer(0, "127.0.0.1", false, { latency: 0, jitter: 0 });
  try {
    const ws = new WebSocket("ws://127.0.0.1:" + srv.port + "/ws"),
          msgs = [] as ServerMsg[];
    ws.on("message", (d: unknown) => { msgs.push(JSON.parse(String(d))); });
    await new Promise<void>(ok => ws.on("open", () => ok()));
    ws.send(JSON.stringify({ t: "hello", name: "seq" }));
    const wait = (ms: number) => new Promise(ok => setTimeout(ok, ms));
    await wait(200);
    const id = (msgs.find(m => (m.t === "welcome")) as Extract<ServerMsg, { t: "welcome" }>).id,
          acks = () => msgs.filter((m): m is Extract<ServerMsg, { t: "state" }> => (m.t === "state"))
                           .map(m => m.players.find(p => (p.id === id))!.ack);
    for (let k = 1; k <= 12; k++) { ws.send(JSON.stringify({ t: "input", seq: k, mx: 0, my: 0, action: false, boost: false, emote: -1, tool: -1 })); }
    await wait(500);
    const a = acks();
    assert.equal(a[a.length - 1], 12, "all applied");
    const steps = a.slice(1).map((v, k) => (v - a[k])).filter(d => (d > 0));
    assert.ok( (Math.max(...steps) > 1) && (Math.max(...steps) <= 3), "burst worked off a few a tick: " + steps.join(",") );
    ws.close();
  }
  finally {
    srv.close();
  }
});

// D7.4 end to end: a client predicting its own character against the
// real server with made-up delay and jitter, inputs sent every 50 ms as
// the page sends them. Walking about on its own, the server's answers
// should need no correction.
//
test("client prediction against the server with latency and jitter", async () => {
  const srv = await startServer(0, "127.0.0.1", false, { latency: 50, jitter: 20 });
  try {
    const ws = new WebSocket("ws://127.0.0.1:" + srv.port + "/ws");
    let pred: Predictor | null = null, world: World | null = null, id = -1, worldOk = true, worst = 0, states = 0, moved = 0,
        x0 = NaN, y0 = NaN, acked = 0;
    ws.on("message", (d: unknown) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      if (m.t === "welcome") {
        const copy = () => {
          const w = World.fromData(m.level);
          for (const c of m.cells) { w.applyCell(c); }
          return w;
        };
        world = copy();
        id    = m.id;
        pred  = new Predictor(new Game(copy(), { rules: CONFIG.rules, train: CONFIG.train, avatar: CONFIG.avatar, station: CONFIG.station,
                                                 tickHz: CONFIG.server.tickHz }, 1, false), world);
      }
      if ( (m.t === "state") && pred && world ) {
        for (const c of m.cells) { world.applyCell(c); }
        const me = m.players.find(p => (p.id === id))!, before = pred.me;
        pred.reconcile(me, m.train);
        if ( before && !me.dead ) { worst = Math.max(worst, Math.hypot(pred.me!.x - before.x, pred.me!.y - before.y)); }
        if (Number.isNaN(x0)) { x0 = me.x; y0 = me.y; }
        moved = Math.max(moved, Math.hypot(me.x - x0, me.y - y0));
        acked = me.ack;
        states++;
      }
    });
    await new Promise<void>(ok => ws.on("open", () => ok()));
    // The test run's flat, open level (2026-11-20): on the first room's
    // random level, trees or water sometimes blocked the walk.
    //
    ws.send(JSON.stringify({ t: "create", name: "pred", room: "", open: false, difficulty: "test", levels: 2 }));
    const wait = (ms: number) => new Promise(ok => setTimeout(ok, ms));
    for (let t = 0; ( !pred && (t < 100) ); t++) { await wait(50); }
    assert.ok(pred, "welcomed");
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7, -0.7]];
    let last = 0;
    for (let k = 0; k < 60; k++) {
      const [mx, my] = dirs[Math.floor(k / 12) % dirs.length],
            inp = { mx, my, action: false, boost: ((k % 20) === 5), emote: -1, tool: -1, fast: false };
      last = pred!.step(inp);
      ws.send(JSON.stringify({ t: "input", seq: last, ...inp }));
      await wait(50);
    }

    // Until the server has applied every step (a busy machine runs its
    // ticks late), then one more state.
    //
    for (let t = 0; ( (acked < last) && (t < 200) ); t++) { await wait(50); }
    await wait(150);
    assert.equal(acked, last, "every step applied");
    assert.ok(states > 40, states + " states");
    assert.ok(moved > 2, "walked " + moved.toFixed(2) + " cells");
    assert.ok(worst < 1e-6, "largest correction " + worst);
    ws.close();
  }
  finally {
    srv.close();
  }
});

// D7.6: rooms. A page that names no room joins the first; a new room
// can be open (listed) or joined by code only; each room has its own
// players and its own settings; an empty room other than the first is
// closed after `idle` seconds.
//
test("server keeps rooms apart", async () => {
  const srv  = await startServer(0, "127.0.0.1", false, { latency: 0, jitter: 0 }, 0.3),
        wait = (ms: number) => new Promise(ok => setTimeout(ok, ms));

  // Making a room generates its run, which takes a while under load:
  // wait for what is expected (up to 10 s) rather than a fixed time.
  //
  const until = async (ok: () => boolean) => {
    for (let t = 0; ( (t < 10000) && !ok() ); t += 20) { await wait(20); }
    assert.ok(ok(), "timed out");
  };
  const join = async () => {
    const ws = new WebSocket("ws://127.0.0.1:" + srv.port + "/ws"), msgs = [] as ServerMsg[];
    ws.on("message", (d: unknown) => { msgs.push(JSON.parse(String(d))); });
    await new Promise<void>(ok => ws.on("open", () => ok()));
    const say  = (m: object) => ws.send(JSON.stringify(m)),
          last = <T extends ServerMsg["t"]>(t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => (m.t === t)).at(-1);
    return { ws, msgs, say, last };
  };
  try {
    const a = await join(), b = await join(), c = await join();
    a.say({ t: "hello", name: "ann" });
    b.say({ t: "create", name: "bob", room: "Ours", open: false });
    await until(() => ( !!a.last("welcome") && !!b.last("welcome") ));
    const first = a.last("welcome")!.room, ours = b.last("welcome")!.room;
    assert.match(ours, /^[A-HJ-NP-Z]{4}$/);
    assert.notEqual(first, ours);

    c.say({ t: "list" });
    await wait(100);
    assert.deepEqual(c.last("rooms")!.rooms.map(r => r.code), [first], "only the open room is listed");
    c.say({ t: "hello", name: "cat", room: ours.toLowerCase() });
    c.say({ t: "hello", name: "cat", room: "QQQQ" });
    await wait(300);
    assert.equal(c.last("welcome")!.room, ours, "joined by code");
    assert.match(c.last("error")!.text, /QQQQ/);
    const names = (s: { players: { name: string }[] }) => s.players.map(p => p.name).sort();
    assert.deepEqual(names(a.last("state")!), ["ann"]);
    assert.deepEqual(names(c.last("state")!), ["bob", "cat"]);

    // A setting changed in the first room is not seen in the other.
    //
    const carry = (CONFIG.rules as { carryMax: number }).carryMax;
    a.say({ t: "set", section: "rules", key: "carryMax", value: carry + 3 });
    await wait(150);
    assert.ok(a.msgs.some(m => ( (m.t === "config") && (m.value === (carry + 3)) )));
    assert.ok(!b.msgs.some(m => (m.t === "config")), "other room not told");
    b.say({ t: "restart" });
    await until(() => (b.msgs.filter(m => (m.t === "welcome")).length === 2));
    assert.equal((b.last("welcome")!.config.rules as { carryMax: number }).carryMax, carry);
    assert.equal((CONFIG.rules as { carryMax: number }).carryMax, carry, "file settings untouched");

    // An open room made by a client is listed; once everyone has left a
    // room it closes, but the first room stays.
    //
    a.say({ t: "create", name: "ann", room: "Open one", open: true });
    await until(() => (a.msgs.filter(m => (m.t === "welcome")).length === 2));
    const open = a.last("welcome")!.room;
    c.say({ t: "list" });
    await wait(100);
    assert.deepEqual(c.last("rooms")!.rooms.map(r => r.name).sort(), ["Main", "Open one"]);
    assert.equal(c.last("rooms")!.rooms.find(r => (r.code === first))!.players, 0, "ann left the first room");
    b.ws.close();
    c.ws.close();
    a.ws.close();
    await wait(600);
    const d = await join();
    d.say({ t: "hello", name: "dan", room: ours });
    d.say({ t: "hello", name: "dan", room: open });
    d.say({ t: "hello", name: "dan", room: first });
    await wait(200);
    assert.equal(d.msgs.filter(m => (m.t === "error")).length, 2, "empty rooms closed");
    assert.equal(d.last("welcome")!.room, first);
    d.ws.close();
  }
  finally {
    srv.close();
  }
});

// D7.6: a new room's options. Out of range values go to the nearest
// limit, an unknown difficulty to the default; the difficulty set
// changes only the room's settings; a run bigger than ROOM_LIMITS.cells
// is refused. A room's world holds the whole run (D6.4).
//
test("rooms take options", async () => {
  const r = new Room("TEST", { name: "t", open: false, levels: 2, difficulty: "easy", width: 12, length: 60 }, 5);
  assert.equal((r.cfg.rules as { timerSlack: number }).timerSlack, 2);
  assert.notEqual((CONFIG.rules as { timerSlack: number }).timerSlack, 2, "file settings untouched");
  assert.equal(r.game.w.h, 12);
  assert.equal(r.game.w.segments, 2);
  assert.deepEqual([r.info().level, r.info().levels, r.info().width, r.info().length], [1, 2, 12, 60]);

  const srv  = await startServer(0, "127.0.0.1", false, { latency: 0, jitter: 0 }),
        wait = (ms: number) => new Promise(ok => setTimeout(ok, ms));
  try {
    const ws = new WebSocket("ws://127.0.0.1:" + srv.port + "/ws"), msgs = [] as ServerMsg[];
    ws.on("message", (d: unknown) => { msgs.push(JSON.parse(String(d))); });
    await new Promise<void>(ok => ws.on("open", () => ok()));
    const say  = (m: object) => ws.send(JSON.stringify(m)),
          last = <T extends ServerMsg["t"]>(t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => (m.t === t)).at(-1);
    say({ t: "list" });
    await wait(100);
    const rooms = last("rooms")!;
    assert.deepEqual(rooms.difficulties, ["easy", "moderate", "hard", "test"]);
    assert.equal(rooms.defaults.levels, 12);
    assert.equal(rooms.defaults.difficulty, "moderate");
    assert.equal(rooms.rooms[0].levels, 12, "the first room runs 12 levels");

    say({ t: "create", name: "x", room: "big", open: true, levels: 999, width: 3, length: 1e6 });
    await wait(200);
    assert.match(last("error")!.text, /too big: .* 150000, at most 110000/);
    assert.equal(last("welcome"), undefined);
    say({ t: "create", name: "x", room: "long", open: true, levels: 30, width: 3, length: 1, difficulty: "nightmare" });
    await wait(1500);
    const w = last("welcome")!;
    assert.deepEqual([w.info.levels, w.info.width, w.info.length, w.info.difficulty, w.seg], [30, 10, 50, "moderate", 0]);
    assert.deepEqual([w.level.w, w.level.h], [50 + (29 * (50 - 6 - 2)), 10]);

    // Leaving takes the player out; the room is still listed (empty).
    //
    say({ t: "leave" });
    say({ t: "list" });
    await wait(150);
    assert.equal(last("rooms")!.rooms.find(x => (x.code === w.room))!.players, 0);
    ws.close();
  }
  finally {
    srv.close();
  }
});
