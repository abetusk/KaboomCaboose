// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Messages between the server and clients, sent as JSON over a WebSocket
// (D7.3). The server owns the game (D7.2); clients send numbered input
// steps and draw the state they are sent, moving their own character
// ahead of it (D7.4). Each game runs in a room (D7.6): a client joins
// one by code, makes a new one, or asks for the list of open ones.
//

import type { LevelData, CellState } from "../sim/world.ts";
import type { Input, Phase, Train, Pad, Offer } from "../sim/game.ts";
import type { Bomb } from "../sim/dynamite.ts";

export interface PlayerView {
  id        : number;
  name      : string;
  character : string;
  x         : number;
  y         : number;
  level     : number;
  facing    : number;
  heading   : number;
  carry     : number;
  count     : number;
  hitting   : boolean;
  boosting  : boolean;
  dead      : boolean;
  emote     : number;
  tool      : number;
  denied    : boolean;

  // Timers and per-press state, and the seq of the last input from this
  // player's client that the server has applied: what the client needs
  // to replay its later inputs on top of this state (D7.4).
  //
  boostT     : number;
  boostCd    : number;
  hitT       : number;
  denyT      : number;
  emoteT     : number;
  lastAction : boolean;
  lastCell   : number;
  ack        : number;

  // A dynamite stick in hand (D6.12): fuse seconds left (-1 unlit) and
  // seconds the throw has been aimed (-1 not aiming).
  //
  fuse       : number;
  aimT       : number;
}

// Server to client.
//
export interface Welcome {
  t      : "welcome";
  id     : number;
  room   : string;
  info   : RoomInfo;
  seed   : number;

  // The level being played (0 first) of the run's world (D6.4); `cells`
  // are only those changed since the world was made.
  //
  seg    : number;

  // The server takes development shortcuts (DevMsg; server --dev).
  //
  dev    : boolean;
  level  : LevelData;
  cells  : CellState[];
  config : Record<string, Record<string, unknown>>;
}

// A setting changed (by any player in the settings panel).
//
export interface ConfigMsg {
  t       : "config";
  section : string;
  key     : string;
  value   : number | boolean;
}

export interface State {
  t       : "state";
  time    : number;
  startT  : number;
  limit   : number;
  pad     : Pad;
  phase   : Phase;
  train   : Train;

  // The level being played (0 first); it moves on after arriving.
  //
  seg     : number;

  // Upgrades on offer at the station arrived at, and the one picked
  // there ("" none yet) (D6.7).
  //
  offers  : Offer[];
  picked  : string;

  // How many of each upgrade this run has taken (D6.7), for showing them
  // on the characters and wagons.
  //
  taken   : Record<string, number>;

  // Lit dynamite put down or thrown (D6.12).
  //
  bombs   : Bomb[];
  players : PlayerView[];
  cells   : CellState[];
  events  : string[];

  // Seconds until the next level starts, after this one ended; -1 while
  // it runs.
  //
  next    : number;

  // In the walk-in lobby only: its circles.
  //
  lobby?  : LobbyPad[];
}

// A circle in the walk-in lobby (2026-11-20): standing in it for
// station.dwellSeconds acts. `kind` "character" takes that character
// (value: its name), "create" makes a listed run of that difficulty and
// joins it, "join" joins that room (value: its code). `label`: the lines
// shown over it. `progress`: seconds stood in it by whoever has stood
// longest.
//
export interface LobbyPad {
  x        : number;
  y        : number;
  kind     : "character" | "create" | "join";
  value    : string;
  label    : string[];
  progress : number;
}

// A room as listed: its code, name, whether anyone may see it in the
// list (open) or only those given the code, how many are in it, the
// level being played out of the run's levels, the level size and the
// difficulty set.
//
export interface RoomInfo {
  code       : string;
  name       : string;
  open       : boolean;
  players    : number;
  level      : number;
  levels     : number;
  width      : number;
  length     : number;
  difficulty : string;

  // The walk-in lobby (server/lobby.ts), not a run: no train leaves, and
  // circles on the ground pick a character, make a run or join one.
  //
  lobby?     : boolean;
}

// Options for a new room, as limits [min, max] and starting values. A
// run is one world of about levels x width x length cells (D6.4), made
// when the room is; `cells` caps that (12 levels of 30 x 300 fit), since
// making it holds up the server (about 1.8 s for 12 levels of 30 x 300)
// and the page draws all of it.
//
export const ROOM_LIMITS = { levels: [1, 50], width: [10, 30], length: [50, 300], cells: 110000 } as const;

export interface RoomDefaults {
  levels     : number;
  width      : number;
  length     : number;
  difficulty : string;
}

// The open rooms, in answer to ListMsg, with the difficulty sets on offer
// and the starting values for a new room.
//
export interface RoomsMsg {
  t            : "rooms";
  rooms        : RoomInfo[];
  difficulties : string[];
  defaults     : RoomDefaults;
}

// A request could not be done (an unknown room code, or a room whose
// run could not be made).
//
export interface ErrorMsg {
  t    : "error";
  text : string;
}

// What a development shortcut did (DevMsg).
//
export interface DevSaid {
  t    : "said";
  text : string;
}

// The run ended (a crash, or the last station reached): the player is
// out of the room, back in the lobby, and told why.
//
export interface OverMsg {
  t    : "over";
  text : string;
}

// Client to server.
//
// Join a room by code; without one, the server's first room. The server
// answers with Welcome, or ErrorMsg for an unknown code.
//
export interface Hello {
  t          : "hello";
  name       : string;
  room?      : string;
  character? : string;
}

// Go into the walk-in lobby (server/lobby.ts; answered with Welcome),
// as AR players do: page HTML is not shown in the headset.
//
export interface LobbyMsg {
  t          : "lobby";
  name       : string;
  character? : string;
}

// Make a room and join it (answered with Welcome); open rooms are listed.
// `name` is the player's name, `room` the room's. Missing or out of range
// options take the defaults (RoomsMsg) or the nearest limit (ROOM_LIMITS).
//
export interface CreateMsg {
  t           : "create";
  name        : string;
  room        : string;
  open        : boolean;
  levels?     : number;
  width?      : number;
  length?     : number;
  difficulty? : string;
  character?  : string;
}

export interface ListMsg {
  t : "list";
}

// Leave the room (back to the lobby).
//
export interface LeaveMsg {
  t : "leave";
}

// A development shortcut (server/dev.ts), taken only by a server started
// with --dev; answered with DevSaid.
//
export interface DevMsg {
  t   : "dev";
  cmd : string;
}

// One input step, sent tickHz times a second. `seq` counts them up from
// 1; the server applies each exactly once, in order, and reports the
// last it applied as the player's `ack` (D7.4).
//
export interface InputMsg extends Input {
  t    : "input";
  seq? : number;
}

// Change a setting, or restart the level, from the settings panel.
//
export interface SetMsg {
  t       : "set";
  section : string;
  key     : string;
  value   : number | boolean;
}

export interface RestartMsg {
  t : "restart";
}

// Sections the settings panel may change on the server. Level generator
// settings take effect from the next level.
//
export const SHARED_SECTIONS = ["rules", "train", "avatar", "station", "levelgen"];

export type ServerMsg = Welcome | State | ConfigMsg | RoomsMsg | ErrorMsg | OverMsg | DevSaid;
export type ClientMsg = Hello | InputMsg | SetMsg | RestartMsg | CreateMsg | ListMsg | LeaveMsg | DevMsg | LobbyMsg;

// The characters a player can be (D11a.2); `character` in Hello,
// CreateMsg and LobbyMsg picks one, otherwise the server deals them out
// in turn.
//
export const CHARACTERS = ["knight", "zombie", "robot"];

export const EMOTES = ["Here!", "Wood!", "Ore!", "Track!", "Help!", "Yes", "No", "Hurry!"];
