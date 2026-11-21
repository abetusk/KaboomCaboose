// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The walk-in lobby (2026-11-20): a room like any other, shared by every
// player in it, on a small yard (src/gen/lobby.ts) where no run starts.
// AR players are put here, since page HTML is not shown in the headset;
// page players use the HTML lobby. Standing in a circle for
// station.dwellSeconds acts, each player for themself: a character
// circle takes that character, a new-run circle makes a listed run of
// its difficulty and joins it, a room circle joins that room. The yard
// is made afresh whenever the last player leaves (trees chopped and rock
// mined there come back).
//

import { Room, CHARACTERS, type Client } from "./room.ts";
import { World } from "../src/sim/world.ts";
import { Game, PAD_RADIUS } from "../src/sim/game.ts";
import { lobbyGrid, lobbySpots } from "../src/gen/lobby.ts";
import type { ClientMsg, LobbyPad, RoomInfo, State } from "../src/net/protocol.ts";

// What the lobby needs from the server: the open rooms as listed, the
// difficulties, and acting for a player as if they had sent a message
// (a hello to join, a create to make a run).
//
export interface LobbyHooks {
  rooms        : () => RoomInfo[];
  difficulties : string[];
  act          : (c: Client, m: ClientMsg) => void;
}

// Levels in a run made from the lobby: the server's usual, but the test
// run's 4 (as the HTML lobby sets).
//
const TEST_LEVELS = 4;

export class LobbyRoom extends Room {
  private hooks : LobbyHooks;
  private pads  : LobbyPad[];

  // Per player: the circle they stand in ("kind:value") and for how long.
  //
  private stand : Map<number, { key: string, t: number }>;

  constructor(code: string, hooks: LobbyHooks) {
    super(code, { name: "Lobby", open: false, levels: 1, difficulty: "easy" }, 1);
    this.hooks = hooks;
    this.pads  = [];
    this.stand = new Map();
  }

  protected newRun(): Game {
    const g = new Game(new World(lobbyGrid(this.cfg.levelgen.stationLength as number)), this.settings, this.seed);
    g.lobby = true;
    return g;
  }

  info(): RoomInfo { return { ...super.info(), lobby: true }; }

  protected extra(): Partial<State> { return { lobby: this.pads }; }

  leave(c: Client): void {
    super.leave(c);
    this.stand.delete(c.id);
    if (this.clients.size === 0) { this.game = this.newRun(); }
  }

  // The circles as they are now: the characters, a new run per
  // difficulty, and the first open rooms.
  //
  private layout(): LobbyPad[] {
    const diffs = this.hooks.difficulties, spots = lobbySpots(CHARACTERS.length, diffs.length),
          open  = this.hooks.rooms().slice(0, spots.join.length),
          pad   = (at: [number, number], kind: LobbyPad["kind"], value: string, label: string[]): LobbyPad =>
                  ({ x: at[0], y: at[1], kind, value, label, progress: 0 });
    return [
      ...CHARACTERS.map((ch, k) => pad(spots.character[k], "character", ch, [ch.toUpperCase()])),
      ...diffs.map((d, k) => pad(spots.create[k], "create", d, ["NEW", d.toUpperCase()])),
      ...open.map((r, k) => pad(spots.join[k], "join", r.code, ["JOIN", r.name.toUpperCase().slice(0, 12)])),
    ];
  }

  tick(): void {
    this.pads = this.layout();
    const dwell = this.settings.station.dwellSeconds, dt = 1 / this.settings.tickHz, acts = [] as [Client, LobbyPad][];
    for (const c of this.clients.values()) {
      const p   = this.game.players.get(c.id),
            pad = ( ( p && (p.dead <= 0) ) ? this.pads.find(q => (Math.hypot(p.x - q.x, p.y - q.y) < PAD_RADIUS)) : undefined );

      // Out of every circle, or in the character circle already taken:
      // nothing counts.
      //
      if ( !p || !pad || ( (pad.kind === "character") && (p.character === pad.value) ) ) { this.stand.delete(c.id); continue; }
      const key = pad.kind + ":" + pad.value, was = this.stand.get(c.id),
            t   = ( ( was && (was.key === key) ) ? (was.t + dt) : dt );
      this.stand.set(c.id, { key, t });
      pad.progress = Math.max(pad.progress, Math.min(t, dwell));
      if (t >= (dwell - 1e-9)) { acts.push([c, pad]); }
    }

    // Acted on after the look round: joining a room takes the player out
    // of this one.
    //
    for (const [c, pad] of acts) {
      const p = this.game.players.get(c.id)!;
      this.stand.delete(c.id);
      if (pad.kind === "character") {
        c.character = pad.value;
        p.character = pad.value;
      }
      else if (pad.kind === "create") {
        this.hooks.act(c, { t: "create", name: p.name, room: "", open: true, difficulty: pad.value, character: c.character,
                            ...( (pad.value === "test") ? { levels: TEST_LEVELS } : {} ) });
      }
      else {
        this.hooks.act(c, { t: "hello", name: p.name, room: pad.value, character: c.character });
      }
    }
    super.tick();
  }
}
