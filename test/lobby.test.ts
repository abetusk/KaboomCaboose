// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The walk-in lobby (server/lobby.ts): no run starts there, and standing
// in a circle takes a character, makes a run or joins a room.
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_INPUT } from "../src/sim/game.ts";
import { CONFIG } from "../src/config.ts";
import { Room, type Client } from "../server/room.ts";
import { LobbyRoom } from "../server/lobby.ts";
import { Lag } from "../server/lag.ts";
import type { ClientMsg, ServerMsg, State } from "../src/net/protocol.ts";

function client(id: number): Client & { got: ServerMsg[] } {
  const got = [] as ServerMsg[];
  return { ws: { readyState: 1, send: (t: string) => got.push(JSON.parse(t)) } as never, id, up: new Lag(0, 0), down: new Lag(0, 0),
           room: null, queue: [], held: { ...NO_INPUT }, ack: 0, got };
}

const lastState = (c: { got: ServerMsg[] }) => c.got.filter(m => (m.t === "state")).at(-1) as State;

function lobby(acted: [Client, ClientMsg][] = [], rooms: Room[] = []): LobbyRoom {
  return new LobbyRoom("LOBBY", { rooms: () => rooms.map(r => r.info()), difficulties: ["easy", "test"],
                                  act: (c, m) => { acted.push([c, m]); } });
}

// Stand player id in the circle of that kind and value until it acts.
//
function standIn(l: LobbyRoom, id: number, kind: string, value: string): void {
  l.tick();
  const c = l.clients.get(id)!, pad = (lastState(c as never).lobby ?? []).find(q => ( (q.kind === kind) && (q.value === value) ))!;
  assert.ok(pad, kind + " " + value + " circle");
  const p = l.game.players.get(id)!;
  for (let k = 0; k < Math.ceil((CONFIG.station.dwellSeconds + 0.5) * CONFIG.server.tickHz); k++) {
    p.x = pad.x; p.y = pad.y;
    l.tick();
  }
}

test("the walk-in lobby is marked so, shows its circles, and no run starts", () => {
  const l = lobby(), a = client(1);
  l.join(a, "ann");
  assert.equal((a.got[0] as { info: { lobby?: boolean } }).info.lobby, true);
  standIn(l, 1, "character", "robot");
  for (let k = 0; k < (5 * CONFIG.server.tickHz); k++) { l.game.players.get(1)!.x = l.game.pad.x; l.game.players.get(1)!.y = l.game.pad.y; l.tick(); }
  assert.equal(l.game.phase, "ready");
  const kinds = (lastState(a).lobby ?? []).map(q => q.kind + ":" + q.value);
  assert.deepEqual(kinds, ["character:knight", "character:zombie", "character:robot", "create:easy", "create:test"]);
});

test("a character circle takes that character, kept for the rooms joined after", () => {
  const l = lobby(), a = client(1);
  l.join(a, "ann");
  standIn(l, 1, "character", "zombie");
  assert.equal(l.game.players.get(1)!.character, "zombie");
  assert.equal(a.character, "zombie");
  const r = new Room("ROOM", { name: "r", open: true, levels: 2, difficulty: "test" }, 1);
  r.join(a, "ann");
  assert.equal(r.game.players.get(1)!.character, "zombie");
  assert.equal(l.clients.size, 0, "joining a room leaves the lobby");
});

test("a new-run circle asks for a listed run of its difficulty; a room circle joins that room", () => {
  const acted = [] as [Client, ClientMsg][], r = new Room("ROOM", { name: "Fun", open: true, levels: 2, difficulty: "test" }, 1),
        l = lobby(acted, [r]), a = client(1), b = client(2);
  l.join(a, "ann");
  l.join(b, "bob");
  standIn(l, 1, "create", "test");
  assert.deepEqual(acted.map(([c, m]) => [c.id, m.t, (m as { difficulty?: string }).difficulty, (m as { open?: boolean }).open,
                                           (m as { levels?: number }).levels]), [[1, "create", "test", true, 4]]);
  acted.length = 0;

  // The server's create moves the player into the new room.
  //
  l.leave(a);
  standIn(l, 2, "join", "ROOM");
  assert.deepEqual(acted.map(([c, m]) => [c.id, m.t, (m as { room?: string }).room]), [[2, "hello", "ROOM"]]);
  assert.deepEqual((lastState(b).lobby ?? []).find(q => (q.kind === "join"))!.label, ["JOIN", "FUN"]);
});
