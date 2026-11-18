// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Keyboard, gamepad and AR controller input (D3.6-D3.8). Bindings come from the input
// section of config/game.json; a person's own bindings, from
// config/keys/<name>.json chosen with ?keys=<name>, replace the defaults
// action by action. The browser remembers the last ?keys choice.
//

import { CONFIG, type InputConfig } from "../config.ts";
import { EMOTES } from "../net/protocol.ts";
import { Tool, TOOL_NEXT, TOOL_PREV } from "../sim/game.ts";

const STORE = "voxel-rail.keys";

// AR controller controls by button number in the xr-standard gamepad
// mapping (WebXR Gamepads Module: 0 trigger, 3 thumbstick press; 1,
// the squeeze, grabs the board instead) and Meta's Touch controllers in
// the WebXR input profiles registry (4 X or A, 5 Y or B). The
// thumbstick is axes 2 and 3.
//
export const XR_BUTTON: Record<string, number> = { "trigger": 0, "thumbstick-press": 3, "x": 4, "a": 4, "y": 5, "b": 5 };

type Hand = "left" | "right";

export async function loadBindings(): Promise<InputConfig> {
  const cfg: InputConfig = JSON.parse(JSON.stringify(CONFIG.input));
  let name = new URL(location.href).searchParams.get("keys");
  try {
    if (name) { localStorage.setItem(STORE, name); }
    else      { name = localStorage.getItem(STORE); }
  }
  catch { }
  if ( !name || !/^[A-Za-z0-9_-]+$/.test(name) ) { return cfg; }
  try {
    const r = await fetch("config/keys/" + name + ".json");
    if (!r.ok) { console.warn("no key bindings named", name); return cfg; }
    const o = await r.json();
    for (const dev of ["keyboard", "gamepad", "xr"] as const) {
      if ( o[dev] && (typeof o[dev] === "object") ) { Object.assign(cfg[dev], o[dev]); }
    }
    if (typeof o.deadzone === "number") { cfg.deadzone = o.deadzone; }
  }
  catch (e) { console.warn("bad key bindings", name, e); }
  return cfg;
}

export interface Frame {
  mx     : number;
  my     : number;
  action : boolean;
  fast   : boolean;
  boost  : boolean;
  emote  : number;
  snap    : boolean;
  camMode : boolean;
  tool    : number;
  help   : boolean;
}

// Reads devices once per frame. Boost, emote sending, camera snap, tool
// changes and help are edges (one frame); action is held. `tool` is -1
// for no change, else as the server's Input.tool.
//
export class Controls {
  cfg      : InputConfig;
  down     : Set<string>;
  pressed  : Set<string>;
  padPrev  : boolean[];
  menu     : boolean;
  pick     : number;
  onMenu   : (open: boolean, pick: number) => void;

  // The AR session's controller gamepads, set by the page each frame;
  // null outside AR or for a hand without a controller.
  //
  xrPads   : Record<Hand, Gamepad | null>;
  xrPrev   : Record<Hand, boolean[]>;

  constructor(cfg: InputConfig, onMenu: (open: boolean, pick: number) => void) {
    this.cfg     = cfg;
    this.down    = new Set();
    this.pressed = new Set();
    this.padPrev = [];
    this.menu    = false;
    this.pick    = -1;
    this.onMenu  = onMenu;
    this.xrPads  = { left: null, right: null };
    this.xrPrev  = { left: [], right: [] };
    addEventListener("keydown", e => {
      if (e.repeat) { return; }
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (this.bound(e.code)) { e.preventDefault(); }
    });
    addEventListener("keyup", e => { this.down.delete(e.code); });
    addEventListener("blur", () => { this.down.clear(); });
  }

  bound(code: string): boolean {
    return Object.values(this.cfg.keyboard).some(list => list.includes(code));
  }

  key(action: keyof InputConfig["keyboard"], edge = false): boolean {
    const set = ( edge ? this.pressed : this.down );
    return this.cfg.keyboard[action].some(k => set.has(k));
  }

  // Sector 0..7 of a direction, clockwise from north; -1 if too short.
  //
  sector(x: number, y: number): number {
    if (Math.hypot(x, y) < 0.5) { return -1; }
    const a = Math.atan2(x, -y);
    return ( (Math.round(a / (Math.PI / 4)) + 8) % 8 );
  }

  read(): Frame {
    const f: Frame = { mx: 0, my: 0, action: false, fast: false, boost: false, emote: -1, snap: false, camMode: false, tool: -1, help: false };
    let kx = ( (this.key("right") ? 1 : 0) - (this.key("left") ? 1 : 0) ),
        ky = ( (this.key("down") ? 1 : 0) - (this.key("up") ? 1 : 0) );
    f.action = this.key("action");
    f.fast   = this.key("fastForward");
    f.boost  = this.key("boost", true);
    f.snap   = this.key("cameraSnap", true);
    f.help    = this.key("help", true);
    f.camMode = this.key("cameraMode", true);
    if      (this.key("pickaxe", true))  { f.tool = Tool.PICK; }
    else if (this.key("axe", true))      { f.tool = Tool.AXE; }
    else if (this.key("noTool", true))   { f.tool = Tool.NONE; }
    else if (this.key("toolNext", true)) { f.tool = TOOL_NEXT; }
    else if (this.key("toolPrev", true)) { f.tool = TOOL_PREV; }
    let toggle = this.key("emoteMenu", true), send = this.key("emoteSend", true);
    let px = 0, py = 0;

    // First connected gamepad, standard mapping. A binding is one button
    // number or a list of them.
    //
    const pad = ( navigator.getGamepads ? [...navigator.getGamepads()].find(g => g) : null );
    if (pad) {
      const g = this.cfg.gamepad, dz = this.cfg.deadzone,
            stick = (name: string): [number, number] => ( (name === "right-stick") ? [pad.axes[2] ?? 0, pad.axes[3] ?? 0] : [pad.axes[0] ?? 0, pad.axes[1] ?? 0] ),
            list = (b: number | number[]) => ( Array.isArray(b) ? b : [b] ),
            btn  = (b: number | number[]) => list(b).some(k => !!pad.buttons[k]?.pressed),
            edge = (b: number | number[]) => list(b).some(k => ( !!pad.buttons[k]?.pressed && !this.padPrev[k] ));
      const [mx, my] = stick(g.move);
      if (Math.hypot(mx, my) > dz) { kx += mx; ky += my; }
      [px, py] = stick(g.emotePick);
      f.action = ( f.action || btn(g.action) );
      f.fast   = ( f.fast || btn(g.fastForward) );
      f.boost  = ( f.boost || edge(g.boost) );
      f.snap    = ( f.snap || edge(g.cameraSnap) );
      f.camMode = ( f.camMode || edge(g.cameraMode) );

      // Tool stepping. A button shared with sending an emote (the right
      // trigger by default) sends while the emote menu is open and steps
      // the tool otherwise.
      //
      const sendKeys = list(g.emoteSend),
            free     = (b: number | number[]) => list(b).filter(k => ( !this.menu || !sendKeys.includes(k) ));
      if      (edge(free(g.toolNext))) { f.tool = TOOL_NEXT; }
      else if (edge(free(g.toolPrev))) { f.tool = TOOL_PREV; }
      toggle   = ( toggle || edge(g.emoteMenu) );
      send     = ( send || edge(g.emoteSend) );
      this.padPrev = pad.buttons.map(b => b.pressed);
    }

    // AR controllers: each binding names a hand and a control.
    //
    const xp = this.xrPads;
    if ( xp.left || xp.right ) {
      const x = this.cfg.xr, dz = this.cfg.deadzone,
            num  = (c: [string, string]) => XR_BUTTON[c[1]],
            btn  = (c: [string, string], prev = false) => {
              const p = ( prev ? this.xrPrev[c[0] as Hand] : xp[c[0] as Hand]?.buttons.map(b => b.pressed) ), k = num(c);
              return ( (p !== undefined) && (k !== undefined) && !!p[k] );
            },
            edge  = (c: [string, string]) => ( btn(c) && !btn(c, true) ),
            stick = (c: [string, string]): [number, number] => {
              const p = xp[c[0] as Hand];
              return ( (p && (c[1] === "thumbstick")) ? [p.axes[2] ?? 0, p.axes[3] ?? 0] : [0, 0] );
            };
      const [mx, my] = stick(x.move);
      if (Math.hypot(mx, my) > dz) { kx += mx; ky += my; }
      const [ex, ey] = stick(x.emotePick);
      if (Math.hypot(ex, ey) > Math.hypot(px, py)) { px = ex; py = ey; }
      f.action = ( f.action || btn(x.action) );
      f.fast   = ( f.fast || btn(x.fastForward) );
      f.boost  = ( f.boost || edge(x.boost) );
      f.snap    = ( f.snap || edge(x.cameraSnap) );
      f.camMode = ( f.camMode || edge(x.cameraMode) );
      toggle   = ( toggle || edge(x.emoteMenu) );
      send     = ( send || edge(x.emoteSend) );

      // Tool stepping. A control shared with sending an emote (the right
      // trigger by default) sends while the emote menu is open and steps
      // the tool otherwise.
      //
      const same = (a: [string, string], b: [string, string]) => ( (a[0] === b[0]) && (a[1] === b[1]) ),
            free = (c: [string, string]) => ( !this.menu || !same(c, x.emoteSend) );
      if      ( edge(x.toolPrev) && free(x.toolPrev) ) { f.tool = TOOL_PREV; }
      else if ( edge(x.toolNext) && free(x.toolNext) ) { f.tool = TOOL_NEXT; }
    }
    this.xrPrev = { left: xp.left?.buttons.map(b => b.pressed) ?? [], right: xp.right?.buttons.map(b => b.pressed) ?? [] };
    this.pressed.clear();

    // Emote menu: while open on the keyboard, the move keys pick and the
    // character stands still (D3.6).
    //
    if (toggle) { this.menu = !this.menu; this.pick = -1; }
    if (this.menu) {
      const s = ( (this.sector(px, py) >= 0) ? this.sector(px, py) : this.sector(kx, ky) );
      if (s >= 0) { this.pick = s % EMOTES.length; }
      if (Math.hypot(px, py) < 0.5) { kx = 0; ky = 0; }
      if ( send && (this.pick >= 0) ) { f.emote = this.pick; this.menu = false; }
    }
    this.onMenu(this.menu, this.pick);
    f.mx = Math.max(-1, Math.min(1, kx));
    f.my = Math.max(-1, Math.min(1, ky));
    return f;
  }
}
