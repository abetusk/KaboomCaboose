// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// AR mode without a headset: how grabs move the board (src/client/
// board.ts), and the AR controller bindings read as game input
// (src/client/input.ts) from stand-in gamepads.
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { dwell, DWELL_RADIUS, DWELL_TIME, faceYaw, moveTwo, SCALE_MIN, SCALE_MAX, type BoardPose, type Dwell, type P3 } from "../src/client/board.ts";

const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-9, msg + ": " + a + " vs " + b);

// Where a point on the board (board units) lands in the room, turning as
// three.js does for rotation.y.
//
function room(b: BoardPose, x: number, z: number): P3 {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return { x: b.x + (b.scale * ((x * c) + (z * s))), y: b.y, z: b.z + (b.scale * ((-x * s) + (z * c))) };
}

test("AR board: south edge faces the viewer (D3.5)", () => {
  const b = { x: 1, y: 0.7, z: -1 }, viewer = { x: 1, y: 1.6, z: 0 };
  const pose = { ...b, yaw: faceYaw(b, viewer), scale: 0.02 },
        south = room(pose, 0, 10);
  assert.ok(south.z > b.z, "the +z edge is on the viewer's side");
  near(south.x, b.x, "straight toward the viewer");
});

test("AR board: two grabs turn and resize it about the hands (D3.4)", () => {
  const b0: BoardPose = { x: 0.3, y: 0.75, z: -0.5, yaw: 0.4, scale: 0.02 };

  // Hands apart along x, then turned a quarter about the vertical and
  // twice as far apart: the board turns a quarter, doubles, and the
  // board point that was between the hands stays between them.
  //
  const a0 = { x: -0.2, y: 1, z: 0 }, c0 = { x: 0.2, y: 1, z: 0 },
        a  = { x: 0, y: 1, z: 0.4 }, c = { x: 0, y: 1, z: -0.4 };
  const two = moveTwo(b0, a0, c0, a, c);
  near(two.yaw - b0.yaw, Math.atan2(c.x - a.x, c.z - a.z) - Math.atan2(c0.x - a0.x, c0.z - a0.z), "turn");
  near(two.scale, 0.04, "twice the size");
  const cc = Math.cos(b0.yaw), ss = Math.sin(b0.yaw),
        dx = 0 - b0.x, dz = 0 - b0.z,
        mx = ((dx * cc) - (dz * ss)) / b0.scale, mz = ((dx * ss) + (dz * cc)) / b0.scale,
        m1 = room(two, mx, mz);
  near(m1.x, 0, "midpoint x kept");
  near(m1.z, 0, "midpoint z kept");

  // Size stays within bounds; hands one above the other do not turn it.
  //
  const big = moveTwo(b0, a0, c0, { x: -50, y: 1, z: 0 }, { x: 50, y: 1, z: 0 }),
        small = moveTwo(b0, a0, c0, { x: 0, y: 1, z: 0 }, { x: 0.0001, y: 1, z: 0 });
  near(big.scale, SCALE_MAX, "largest");
  near(small.scale, SCALE_MIN, "smallest");
  const stacked = moveTwo(b0, { x: 0, y: 1, z: 0 }, { x: 0, y: 1.3, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0.01, y: 1.3, z: 0 });
  near(stacked.yaw, b0.yaw, "no turn from stacked hands");
});

test("AR controllers drive the game as the xr bindings say (D3.3, D3.6)", async () => {
  // Controls listens for keys on the page; there is no page here.
  //
  const g = globalThis as unknown as Record<string, unknown>;
  g.addEventListener = () => { };
  const { Controls, XR_BUTTON } = await import("../src/client/input.ts");
  const { CONFIG } = await import("../src/config.ts");
  const cfg = JSON.parse(JSON.stringify(CONFIG.input));
  let menu = false;
  const c = new Controls(cfg, open => { menu = open; });

  // Stand-in controllers: the given controls held on whichever hand the
  // bindings name, and the given stick tilts (hand, x, y).
  //
  const pad = (axes: number[], pressed: number[]) =>
    ({ axes, buttons: Array.from({ length: 7 }, (_, k) => ({ pressed: pressed.includes(k), touched: false, value: 0 })) }) as unknown as Gamepad;
  const hold = (names: string[], sticks: [string, number, number][] = []) => {
    const pads: Record<string, Gamepad> = {};
    for (const h of ["left", "right"]) {
      const st = sticks.find(([s]) => (s === h)), axes = [0, 0, st ? st[1] : 0, st ? st[2] : 0];
      pads[h] = pad(axes, names.filter(n => (cfg.xr[n][0] === h)).map(n => XR_BUTTON[cfg.xr[n][1]]));
    }
    c.xrPads = pads as typeof c.xrPads;
  };
  const moveHand = cfg.xr.move[0], pickHand = cfg.xr.emotePick[0];

  hold(["action"], [[moveHand, 0.8, -0.6]]);
  let f = c.read();
  near(f.mx, 0.8, "the move stick moves (x)");
  near(f.my, -0.6, "the move stick moves (y)");
  assert.equal(f.action, true, "the action control held is the action");
  assert.equal(f.boost, false);

  hold(["boost", "emoteMenu"]);
  f = c.read();
  assert.equal(f.boost, true, "a boost press boosts");
  assert.equal(menu, true, "the emote menu control opens the menu");
  f = c.read();
  assert.equal(f.boost, false, "boost is an edge, not held");

  // Pick with the pick stick (east), then send.
  //
  hold([], [[pickHand, 1, 0]]);
  c.read();
  hold(["emoteSend"], [[pickHand, 1, 0]]);
  f = c.read();
  assert.equal(f.emote, 2, "east is the third emote");
  assert.equal(menu, false, "sending closes the menu");

  // Tool steps; a control shared with sending sends instead while the
  // emote menu is open.
  //
  const { TOOL_PREV, TOOL_NEXT } = await import("../src/sim/game.ts");
  hold([]);
  c.read();
  hold(["toolPrev"]);
  assert.equal(c.read().tool, TOOL_PREV, "previous tool");
  hold([]);
  c.read();
  hold(["toolNext"]);
  assert.equal(c.read().tool, TOOL_NEXT, "next tool");
  hold(["emoteMenu"]);
  c.read();
  hold(["emoteSend"], [[pickHand, 1, 0]]);
  f = c.read();
  assert.equal(f.emote, 2, "menu open: the send control sends");
  const shared = ["toolPrev", "toolNext"].some(n => (cfg.xr[n].join() === cfg.xr.emoteSend.join()));
  if (shared) { assert.equal(f.tool, -1, "menu open: no tool step"); }

  // Camera controls (in AR: what the board follows, and dropping a drag).
  //
  hold([]);
  c.read();
  hold(["cameraSnap", "cameraMode"]);
  f = c.read();
  assert.deepEqual([f.snap, f.camMode], [true, true]);

  // No two controls share a button, except tool stepping with sending.
  //
  const names = Object.keys(cfg.xr).filter(n => !["move", "emotePick"].includes(n)),
        key   = (n: string) => cfg.xr[n][0] + ":" + XR_BUTTON[cfg.xr[n][1]];
  for (const a of names) {
    for (const b of names) {
      if ( (a >= b) || (key(a) !== key(b)) ) { continue; }
      const ok = [a, b].includes("emoteSend") && [a, b].some(n => n.startsWith("tool"));
      assert.ok(ok, a + " and " + b + " share a button");
    }
  }

  // A small stick tilt is ignored.
  //
  hold([], [[moveHand, 0.1, 0.05]]);
  f = c.read();
  assert.equal(f.mx, 0);
  assert.equal(f.my, 0);
});

// D3.9: the board settles once the aim has stayed within DWELL_RADIUS
// for DWELL_TIME; a jump, or losing the aim, starts the wait again.
//
test("AR placing settles when the aim holds still", () => {
  const d: Dwell = { at: null, t: 0 }, dt = 0.05,
        steps = Math.ceil(DWELL_TIME / dt);
  let x = 0, settled = false;
  for (let k = 0; k <= steps; k++) {
    settled = dwell(d, { x: x, y: 0.7, z: -0.5 }, dt);
    x += (DWELL_RADIUS * 0.4) / steps;
  }
  assert.ok(settled, "small drift still settles");

  const e: Dwell = { at: null, t: 0 };
  for (let k = 0; k < steps; k++) { dwell(e, { x: 0, y: 0.7, z: -0.5 }, dt); }
  assert.equal(dwell(e, { x: DWELL_RADIUS * 2, y: 0.7, z: -0.5 }, dt), false, "a jump restarts the wait");
  assert.equal(e.t, 0);
  for (let k = 0; k < (steps - 2); k++) { assert.equal(dwell(e, { x: DWELL_RADIUS * 2, y: 0.7, z: -0.5 }, dt), false); }
  assert.equal(dwell(e, null, dt), false, "no aim restarts the wait");
  assert.equal(e.at, null);
});

// A USB gamepad (standard mapping): the triggers step the tool like the
// d-pad, and the right trigger, shared with sending an emote, sends
// instead while the emote menu is open.
//
test("gamepad triggers step the tool (D3.6)", async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.addEventListener = () => { };
  const { Controls } = await import("../src/client/input.ts");
  const { CONFIG } = await import("../src/config.ts");
  const { TOOL_PREV, TOOL_NEXT } = await import("../src/sim/game.ts");
  const cfg = JSON.parse(JSON.stringify(CONFIG.input));
  let menu = false;
  const c = new Controls(cfg, open => { menu = open; });

  // One stand-in pad with the given buttons held and the right stick
  // tilted east.
  //
  let held: number[] = [];
  const pad = () => ({ axes: [0, 0, 1, 0], buttons: Array.from({ length: 17 }, (_, k) => ({ pressed: held.includes(k), touched: false, value: ( held.includes(k) ? 1 : 0 ) })) });
  Object.defineProperty(navigator, "getGamepads", { value: () => [null, pad()], configurable: true });
  const press = (k: number[]) => { held = []; c.read(); held = k; return c.read(); };

  assert.equal(press([6]).tool, TOOL_PREV, "left trigger: previous tool");
  assert.equal(press([7]).tool, TOOL_NEXT, "right trigger: next tool");
  assert.equal(press([14]).tool, TOOL_PREV, "d-pad left still steps back");
  assert.equal(press([15]).tool, TOOL_NEXT, "d-pad right still steps on");
  press([7]);
  assert.equal(c.read().tool, -1, "a held trigger steps once");

  press([cfg.gamepad.emoteMenu]);
  assert.equal(menu, true, "the emote menu is open");
  const f = press([7]);
  assert.equal(f.emote, 2, "menu open: the right trigger sends (east, the third emote)");
  assert.equal(f.tool, -1, "menu open: the right trigger does not step the tool");
  assert.equal(menu, false, "sending closes the menu");
  delete (navigator as unknown as Record<string, unknown>).getGamepads;
});
