// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Tuning values, read from config/game.json (D6a.12). The JSON is the one
// place to change them; this module only types and checks it.
//

import raw from "../config/game.json" with { type: "json" };

export interface Rules {
  C                   : number;
  bridgeTrees         : number;
  carryMax            : number;
  storageMax          : number;
  trackMax            : number;
  hitsPerBlock        : number;
  hitSeconds          : number;
  craftSecondsPerPair : number;
  timerSlack          : number;
  startTrack          : number;
  dynamiteWood        : number;
  dynamiteOre         : number;
  dynamiteSeconds     : number;
  dynamiteMax         : number;
  fuseSeconds         : number;
  blastRadius         : number;
  throwRange          : number;
  throwHoldSeconds    : number;
}

export interface TrainConfig {
  speed         : number;
  acceleration  : number;
  speedPerWagon : number;
  startDelay    : number;
  crashSeconds  : number;
  collideRadius : number;
  fastForward   : number;
}

export interface ServerConfig {
  tickHz : number;
}

export interface AvatarConfig {
  radius         : number;
  wedgeSeconds   : number;
  walkSpeed      : number;
  boostSpeed     : number;
  boostSeconds   : number;
  boostCooldown  : number;
  pushSpeed      : number;
  respawnSeconds : number;
  denySeconds    : number;
}

export interface ViewConfig {
  windowCells  : number;
  cameraHeight : number;
  cameraBack       : number;
  itemSize         : number;
  waterLevel       : number;
  ao                  : boolean;
  aoStrength          : number;
  groundDetail        : boolean;
  groundPatches       : boolean;
  groundPatchStrength : number;
  groundPatchScale    : number;
  groundDecor         : boolean;
  groundDecorDensity  : number;
  groundTints         : boolean;
  groundTintCount     : number;
  groundTintStrength  : number;
  treeTints           : boolean;
  treeTintCount       : number;
  treeTintStrength    : number;
  blackTints          : boolean;
  blackTintCount      : number;
  blackTintStrength   : number;
  rockTints           : boolean;
  rockTintCount       : number;
  rockTintStrength    : number;
  rockPatterns        : number;
  rockPatternScale    : number;
  treeVariety         : boolean;
  treeFill            : number;
  treeScaleJitter     : number;
  treeTint            : number;
  treeSway            : boolean;
  treeSwayAmount      : number;
  rockBoulders        : boolean;
  boulderSpill        : number;
  boulderScale        : number;
  crags               : boolean;
  cragDensity         : number;
  cragHeight          : number;
  blackStrata         : boolean;
  designedTiles       : boolean;
  edgeLines           : boolean;
  carvedBlack         : boolean;
  trainScale          : number;
  toolScale           : number;
  waterVariety        : boolean;
  arCellSize          : number;
  arWindowCells       : number;
  brickRock           : boolean;
  brickRelief         : boolean;
  carvedRelief        : boolean;
  faceDecor           : boolean;
  faceDecorDensity    : number;
  bloom            : boolean;
  bloomStrength    : number;
  bloomRadius      : number;
  bloomThreshold   : number;
  showColliders    : boolean;
}

export interface StationConfig {
  countdownSeconds : number;
  dwellSeconds     : number;
}

// Input bindings (D3.6, D3.8). Actions are the same for every device.
//
export type InputAction = "action" | "boost" | "emoteMenu" | "emoteSend" | "fastForward";

// The camera: on the page it moves the view; in AR it decides what the
// board keeps in its middle and drops a drag.
//
export type ScreenAction = "cameraSnap" | "cameraMode";

// Stepping through the tools: every device.
//
export type ToolAction = "toolPrev" | "toolNext";

export interface InputConfig {
  keyboard : Record<"up" | "down" | "left" | "right" | InputAction | ScreenAction | ToolAction | "pickaxe" | "axe" | "noTool" | "help", string[]>;
  gamepad  : Record<InputAction | ScreenAction | ToolAction, number | number[]> & { move: string, emotePick: string };
  xr       : Record<InputAction | ToolAction | ScreenAction | "move" | "emotePick", [string, string]>;
  deadzone : number;
}

export interface GameConfig {
  rules    : Rules;
  train    : TrainConfig;
  server   : ServerConfig;
  avatar   : AvatarConfig;
  station  : StationConfig;
  view     : ViewConfig;
  input    : InputConfig;
  levelgen : Record<string, unknown>;
}

// Drop the _doc entries and check that every documented key is present,
// and every present key is documented, so a typo in the JSON fails loudly
// instead of silently falling back.
//
function section(name: string): Record<string, unknown> {
  const s   = (raw as unknown as Record<string, Record<string, unknown>>)[name],
        doc = s?._doc as Record<string, string> | undefined;
  if ( !s || !doc ) { throw new Error("config/game.json: section " + name + " or its _doc is missing"); }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(s)) {
    if (k === "_doc") { continue; }
    if (!(k in doc)) { throw new Error("config/game.json: " + name + "." + k + " is not described in _doc"); }
    out[k] = s[k];
  }
  for (const k of Object.keys(doc)) {
    if (!(k in out)) { throw new Error("config/game.json: " + name + "." + k + " is missing"); }
  }
  return out;
}

function numbers<T>(name: string): T {
  const s = section(name);
  for (const [k, v] of Object.entries(s)) {
    if ( (typeof v !== "number") || !Number.isFinite(v) ) { throw new Error("config/game.json: " + name + "." + k + " must be a number"); }
  }
  return s as T;
}

// The view section holds numbers and on/off switches.
//
function view(): ViewConfig {
  const s = section("view");
  for (const [k, v] of Object.entries(s)) {
    if ( (typeof v !== "boolean") && ( (typeof v !== "number") || !Number.isFinite(v) ) ) {
      throw new Error("config/game.json: view." + k + " must be a number or true/false");
    }
  }
  return s as unknown as ViewConfig;
}

// Check the input section's shape: every action bound on every device.
//
function input(): InputConfig {
  const s  = section("input") as unknown as InputConfig,
        bad = (what: string) => { throw new Error("config/game.json: input." + what); };
  for (const k of ["up", "down", "left", "right", "action", "boost", "emoteMenu", "emoteSend", "fastForward", "cameraSnap", "cameraMode", "toolPrev", "toolNext", "pickaxe", "axe", "noTool", "help"]) {
    const v = (s.keyboard as Record<string, unknown>)?.[k];
    if ( !Array.isArray(v) || !v.every(e => (typeof e === "string")) ) { bad("keyboard." + k + " must be a list of key codes"); }
  }
  for (const k of ["action", "boost", "emoteMenu", "emoteSend", "fastForward", "cameraSnap", "cameraMode", "toolPrev", "toolNext"]) {
    const v = (s.gamepad as Record<string, unknown>)?.[k],
          ok = ( Number.isInteger(v) || ( Array.isArray(v) && (v.length > 0) && v.every(b => Number.isInteger(b)) ) );
    if (!ok) { bad("gamepad." + k + " must be a button number or a list of them"); }
  }
  for (const k of ["action", "boost", "emoteMenu", "emoteSend", "fastForward", "toolPrev", "toolNext", "cameraSnap", "cameraMode", "move", "emotePick"]) {
    const v = (s.xr as Record<string, unknown>)?.[k];
    if ( !Array.isArray(v) || (v.length !== 2) || !["left", "right"].includes(v[0]) ) { bad("xr." + k + " must be [hand, control]"); }
  }
  if ( (typeof s.deadzone !== "number") || (s.deadzone < 0) || (s.deadzone >= 1) ) { bad("deadzone must be in [0, 1)"); }
  return s;
}

// Descriptions of every key, by section, for the settings panel.
//
export const DOCS: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(raw as unknown as Record<string, unknown>)
    .filter(([, v]) => ( (typeof v === "object") && (v !== null) && ("_doc" in (v as object)) ))
    .map(([k, v]) => [k, (v as { _doc: Record<string, string> })._doc]));

export const CONFIG: GameConfig = {
  rules    : numbers<Rules>("rules"),
  train    : numbers<TrainConfig>("train"),
  server   : numbers<ServerConfig>("server"),
  avatar   : numbers<AvatarConfig>("avatar"),
  station  : numbers<StationConfig>("station"),
  view     : view(),
  input    : input(),
  levelgen : section("levelgen"),
};
