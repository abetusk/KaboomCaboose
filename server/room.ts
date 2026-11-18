// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// One room (D7.6): a game of its own with its own players, seed and
// settings. The settings are a copy of config/game.json's shared sections
// taken when the room is made, so the settings panel (and later station
// upgrades) change this room only. The server (server/main.ts) keeps the
// rooms and ticks them all.
//

import { CONFIG } from "../src/config.ts";
import { DEFAULTS } from "../src/gen/generate.ts";
import { generateRun } from "../src/gen/run.ts";
import { testRun, testPiles, testLength } from "../src/gen/testrun.ts";
import { World } from "../src/sim/world.ts";
import { Game, type Input, type Settings } from "../src/sim/game.ts";
import { SHARED_SECTIONS, type ServerMsg, type PlayerView, type RoomInfo } from "../src/net/protocol.ts";
import type { WebSocket } from "../vendor/ws/wrapper.mjs";
import type { Lag } from "./lag.ts";
import { applyDifficulty } from "./difficulty.ts";
import { devCommand } from "./dev.ts";

export const CHARACTERS = ["knight", "zombie", "robot"];

// What a room is made with (D7.6): its name, whether it is listed, the
// number of levels in a run, a difficulty set (config/difficulty.json),
// and the level size (unset: the file's).
//
export interface RoomOptions {
  name       : string;
  open       : boolean;
  levels     : number;
  difficulty : string;
  width?     : number;
  length?    : number;
}

export interface Client {
  ws    : WebSocket;
  id    : number;
  up    : Lag;
  down  : Lag;
  room  : Room | null;

  // Inputs come in as numbered steps (D7.4) and wait here; each tick
  // applies the oldest. `held` is the last one applied, `ack` its seq.
  //
  queue : { seq: number, inp: Input }[];
  held  : Input;
  ack   : number;
}

// A tick applies one waiting input per player, or more (up to
// STEPS_MAX) while more than QUEUE_KEEP wait, so a burst after a delay
// is worked off without letting a backlog build up. With none waiting,
// the player does nothing that tick (Input.idle). Past QUEUE_MAX
// the oldest are dropped.
//
export const STEPS_MAX  = 3,
             QUEUE_KEEP = 2,
             QUEUE_MAX  = 40;

type Sections = Record<string, Record<string, unknown>>;

// Seconds from picking a station upgrade to the next level (D6.7): none,
// the pick shows on the characters and wagons instead.
//
const PICKED_WAIT = 0;

// To one client, after its made-up delay (if any).
//
export function sendText(c: Client, text: string): void {
  c.down.run(() => { if (c.ws.readyState === 1) { c.ws.send(text); } });
}

export function send(c: Client, m: ServerMsg): void {
  sendText(c, JSON.stringify(m));
}

export class Room {
  code      : string;
  name      : string;
  open      : boolean;
  cfg       : Sections;
  settings  : Settings;
  seed      : number;
  game      : Game;
  clients   : Map<number, Client>;

  // Wall-clock ms when the level ended (-1 while it runs), and when the
  // last player left (-1 while anyone is in).
  //
  endWall   : number;
  emptyWall : number;

  // Wall-clock ms when this station's upgrade was picked (-1 none yet).
  //
  pickWall  : number;

  // The run (D6.4): its levels joined into one world, played one after
  // another; the level being played is game.w.seg. `first`: the room a
  // client that names none joins, which starts a new run when one ends
  // instead of closing. `closed`: the run ended and everyone was sent
  // back to the lobby; the server drops the room.
  //
  levels     : number;
  difficulty : string;
  first      : boolean;
  closed     : boolean;

  // Development shortcuts are taken (server --dev).
  //
  dev        : boolean;

  // Throws if the run cannot be generated with these options (the server
  // then tells the client and makes no room).
  //
  constructor(code: string, opts: RoomOptions, seed: number, first = false) {
    this.code       = code;
    this.name       = opts.name;
    this.open       = opts.open;
    this.levels     = opts.levels;
    this.first      = first;
    this.closed     = false;
    this.dev        = false;
    this.difficulty = opts.difficulty;
    this.cfg        = structuredClone(Object.fromEntries(SHARED_SECTIONS.map(k => [k, (CONFIG as unknown as Sections)[k]])));
    applyDifficulty(this.cfg, opts.difficulty);
    if (opts.width  !== undefined) { this.cfg.levelgen.width  = opts.width; }
    if (opts.length !== undefined) { this.cfg.levelgen.length = opts.length; }

    // Test levels have a length of their own (src/gen/testrun.ts).
    //
    if (opts.difficulty === "test") { this.cfg.levelgen.length = testLength(this.cfg.levelgen.stationLength as number); }
    this.settings   = { rules: this.cfg.rules, train: this.cfg.train, avatar: this.cfg.avatar, station: this.cfg.station,
                        tickHz: CONFIG.server.tickHz } as unknown as Settings;
    this.seed       = seed;
    this.clients    = new Map();
    this.endWall    = -1;
    this.pickWall   = -1;
    this.emptyWall  = Date.now();
    this.game       = this.newRun();
  }

  private log(...a: unknown[]): void { console.log("[" + this.code + "]", ...a); }

  // A new run from the room's settings as currently set (the settings
  // panel may have changed the level generator's); throws if it cannot
  // be made.
  //
  private newRun(): Game {
    const rules = this.cfg.rules as { C: number, bridgeTrees: number },
          gen   = { ...DEFAULTS, ...this.cfg.levelgen, C: rules.C, bridgeTrees: rules.bridgeTrees, seed: this.seed },
          test  = (this.difficulty === "test"),
          t0    = performance.now(),
          run   = ( test ? testRun(this.levels, gen.width, gen.stationLength) : generateRun(gen, this.levels) ),
          w     = new World(run.grid);
    if (test) { testPiles(w); }
    this.log( (test ? "test run of" : "run of"), this.levels, "levels, seed", this.seed, "size", run.grid.w + "x" + run.grid.h,
             "made in", (performance.now() - t0).toFixed(0), "ms");
    return new Game(w, this.settings, this.seed);
  }

  info(): RoomInfo {
    const gen = this.cfg.levelgen as { width: number, length: number };
    return { code: this.code, name: this.name, open: this.open, players: this.clients.size, level: (this.game.w.seg + 1),
             levels: this.levels, width: gen.width, length: gen.length, difficulty: this.difficulty };
  }

  // A client comes in (leaving any room it was in) and is sent the level.
  //
  join(c: Client, name: string): void {
    if (c.room && (c.room !== this)) { c.room.leave(c); }
    c.room = this;
    this.clients.set(c.id, c);
    this.emptyWall = -1;
    if (!this.game.players.has(c.id)) { this.game.addPlayer(c.id, name, CHARACTERS[(c.id - 1) % CHARACTERS.length]); }
    this.welcome(c);
  }

  leave(c: Client): void {
    if (c.room !== this) { return; }
    c.room = null;
    this.clients.delete(c.id);
    this.game.removePlayer(c.id);
    c.queue = [];
    c.ack   = 0;
    if (this.clients.size === 0) { this.emptyWall = Date.now(); }
  }

  // The world as made, and the cells that have changed since (a fresh
  // world from the same data has every other cell already).
  //
  welcome(c: Client): void {
    const w = this.game.w, data = w.toData(), fresh = World.fromData(data), cells = [] as ReturnType<World["cellState"]>[];
    for (let i = 0; i < (w.w * w.h); i++) {
      if (!w.sameCell(fresh, i)) { cells.push(w.cellState(i)); }
    }
    send(c, { t: "welcome", id: c.id, room: this.code, info: this.info(), seed: this.seed, seg: w.seg, dev: this.dev, level: data, cells,
              config: this.cfg });
  }

  private view(): PlayerView[] {
    return [...this.game.players.values()].map(p => ({
      id: p.id, name: p.name, character: p.character, x: p.x, y: p.y, level: p.level, facing: p.facing, heading: p.heading,
      carry: p.carry, count: p.count, hitting: p.hitting, boosting: (p.boostT > 0), dead: (p.dead > 0),
      emote: ( (p.emoteT > 0) ? p.emote : -1 ), tool: p.tool, denied: (p.denyT > 0),
      boostT: p.boostT, boostCd: p.boostCd, hitT: p.hitT, denyT: p.denyT, emoteT: p.emoteT, lastAction: p.lastAction,
      lastCell: p.lastCell, ack: ( this.clients.get(p.id)?.ack ?? 0 ), fuse: p.fuse, aimT: p.aimT,
    }));
  }

  tick(): void {
    const game = this.game, inputs = new Map<number, Input[]>();
    for (const c of this.clients.values()) {
      const steps = [] as Input[],
            take  = () => { const q = c.queue.shift()!; c.ack = q.seq; c.held = q.inp; steps.push(q.inp); };
      if (c.queue.length > 0) { take(); }
      while ( (c.queue.length > QUEUE_KEEP) && (steps.length < STEPS_MAX) ) { take(); }
      if (!steps.length) { steps.push({ ...c.held, mx: 0, my: 0, boost: false, emote: -1, tool: -1, idle: true }); }
      inputs.set(c.id, steps);
    }
    game.tick(inputs);

    // An upgrade picked this tick changed the room's settings (the game
    // runs on them): everyone in the room is told, so their own copies
    // (and so their prediction, D7.4) match.
    //
    for (const [section, key, value] of game.tuned) {
      this.log("upgrade:", section + "." + key, "=", value);
      const t = JSON.stringify({ t: "config", section, key, value });
      for (const c of this.clients.values()) { sendText(c, t); }
    }
    game.tuned = [];
    if ( game.picked && (this.pickWall < 0) ) { this.pickWall = Date.now(); }

    const cells = [...game.w.changed].map(i => game.w.cellState(i));
    game.w.changed.clear();
    const next = ( (this.endWall < 0) ? -1 : Math.max(0, this.endWait() - ((Date.now() - this.endWall) / 1000)) );
    const msg: ServerMsg = { t: "state", time: game.time, startT: game.startT, limit: game.limit, phase: game.phase, train: game.train,
                             pad: game.pad, seg: game.w.seg, offers: game.offers, picked: game.picked, taken: game.taken, bombs: game.bombs, players: this.view(), cells,
                             events: game.events, next };
    game.events = [];
    const text = JSON.stringify(msg);
    for (const c of this.clients.values()) { sendText(c, text); }

    // After arriving, the station countdown (cut short once an upgrade is
    // picked, D6.7), then on to the next level of the run in the same
    // world. A crash (derailed or out of time) ends the run, as does
    // arriving at the last station: the world stays up for the wait, then
    // everyone goes back to the lobby.
    //
    if (game.ended()) {
      if (this.endWall < 0) { this.endWall = Date.now(); this.log("level", game.w.seg + 1, "ended:", game.phase); }
      if (((Date.now() - this.endWall) / 1000) >= this.endWait()) {
        if ( (game.phase === "arrived") && !game.lastLevel() ) {
          game.nextSegment();
          this.endWall  = -1;
          this.pickWall = -1;
          this.log("on to level", game.w.seg + 1, "of", this.levels);
        }
        else {
          this.over( (game.phase === "arrived") ? ("Run complete: all " + this.levels + " levels.") :
                     ("Game over at level " + (game.w.seg + 1) + " of " + this.levels +
                      ( (game.phase === "timeout") ? ": out of time." : ": derailed." )) );
        }
      }
    }
  }

  // The run ended: everyone is told why and goes back to the lobby. The
  // first room starts a new run; any other closes.
  //
  over(text: string): void {
    this.log(text);
    for (const c of [...this.clients.values()]) {
      send(c, { t: "over", text });
      this.leave(c);
    }
    this.endWall = -1;
    if (this.first) { this.restart(); }
    else            { this.closed = true; }
  }

  // A new run with a new seed (the settings panel's button, and the first
  // room after a run ends); everyone in the room is sent the new world.
  //
  restart(): void {
    this.seed++;
    const old = this.game;
    old.undoUpgrades();
    this.game     = this.newRun();
    this.endWall  = -1;
    this.pickWall = -1;
    for (const c of this.clients.values()) {
      const p = old.players.get(c.id);
      this.game.addPlayer(c.id, p?.name ?? "player", p?.character ?? CHARACTERS[0]);
      this.welcome(c);
    }
  }

  // A development shortcut from client c (server/dev.ts), if the server
  // takes them.
  //
  devCommand(c: Client, cmd: string): void {
    if (!this.dev) { return; }
    const text = devCommand(this.game, c.id, String(cmd));
    this.log("dev", cmd, "->", text);
    send(c, { t: "said", text });
  }

  // Seconds from the level's end to what follows: after arriving, the
  // station countdown, or PICKED_WAIT after an upgrade was picked if that
  // is sooner; after a crash, the crash wait.
  //
  private endWait(): number {
    const s = this.settings;
    if (this.game.phase !== "arrived") { return s.train.crashSeconds; }
    const picked = ( (this.pickWall < 0) ? Infinity : (((this.pickWall - this.endWall) / 1000) + PICKED_WAIT) );
    return Math.min(s.station.countdownSeconds, picked);
  }

  // A setting from the settings panel: only an existing key of a shared
  // section, and only a value of the same type, is taken. Returns whether
  // it was; everyone in the room is told.
  //
  set(section: string, key: string, value: unknown): boolean {
    const sec = this.cfg[section];
    if ( !SHARED_SECTIONS.includes(section) || !sec || !(key in sec) ) { return false; }
    if ( (typeof sec[key] !== typeof value) || ( (typeof value === "number") && !Number.isFinite(value) ) ) { return false; }
    sec[key] = value;
    this.log("setting", section + "." + key, "=", value);
    const text = JSON.stringify({ t: "config", section, key, value });
    for (const o of this.clients.values()) { sendText(o, text); }
    return true;
  }
}
