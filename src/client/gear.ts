// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// What station upgrades look like (D6.7, 2026-11-18): each upgrade taken
// adds something to the characters or the wagons that says what it
// does, and how many times it was taken by how much there is of it.
//
//   carry         a pack on every character's back, one bundle more each
//   speed         wings at every character's heels, a fan of three
//                 feathers, one more each
//   storage       raised side boards on the storage wagons, one more each
//   track         stakes along the crafting wagons' sides to hold the
//                 track, one pair more each
//   craft         a chimney on the crafting wagons, one gold band more each
//   tools         gold heads on every pickaxe and axe, and one gold band
//                 round the handle more each (chopping and mining faster)
//   cheapDynamite the cost on the dynamite wagon's sides drops, its
//                 digits turn gold
//
// The dynamite wagon always shows what a stick costs on both sides, in
// block digits: a wood block and its number, an ore block and its
// number.
//
// Sizes are in cells. Character gear hangs on the Kenney characters'
// bones (torso, leg-left, leg-right), so it moves with them; wagon gear
// is in the car model's own units (before view.trainScale), the car
// centred on x (along it) and z, its floor at y = 0.
//

import * as THREE from "three";
import { handTool } from "./handtools.ts";

const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c });
const PACK   = mat(0x9a6a3a), STRAP = mat(0x5a3a1e),
      FEATHER = mat(0xf4f0e6), GOLD = mat(0xf0c040),
      BOARD  = mat(0xd0a060), STEEL = mat(0x7d8a96),
      SOOT   = mat(0x3a3330), PLATE = mat(0x2a1a14),
      WOOD   = mat(0x8a5a2b), ORE = mat(0xa8b0ba), CREAM = mat(0xf4ecd8);

// The parts an offered upgrade adds glow gold in the offer's picture; the
// page pulses this material's glow.
//
export const GLOW = new THREE.MeshLambertMaterial({ color: 0xf0c040, emissive: 0xf0a000, emissiveIntensity: 0.6 });

function box(g: THREE.Object3D, sx: number, sy: number, sz: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  g.add(o);
  return o;
}

// ---- characters ----

// The pack: a porter's frame on the back, rising behind the head (the
// characters' heads are big and hide the back from above), with `n`
// bundles stacked on it, each tied with a strap.
//
function pack(n: number, glowLast = false): THREE.Group {
  const g = new THREE.Group();
  for (const s of [1, -1]) { box(g, 0.025, 0.12 + (n * 0.12), 0.025, STRAP, s * 0.1, 0.06 + (n * 0.06), -0.2); }
  box(g, 0.2, 0.03, 0.12, STRAP, 0, 0.02, -0.22);
  for (let k = 0; k < n; k++) {
    const y = 0.09 + (k * 0.12);
    box(g, 0.22 - (k * 0.02), 0.11, 0.12, ( ( glowLast && (k === (n - 1)) ) ? GLOW : PACK ), 0, y, -0.26);
    box(g, 0.225 - (k * 0.02), 0.02, 0.125, STRAP, 0, y, -0.26);
  }
  return g;
}

// A wing at the heel, swept back and out: a fan of n + 2 feathers
// spreading up and back, the lowest the longest. `side` is 1 for the
// left leg, -1 for the right.
//
function wing(n: number, side: number, glowLast = false): THREE.Group {
  const g = new THREE.Group(), m = n + 2;
  for (let k = 0; k < m; k++) {
    const len = 0.2 - (k * 0.025), f = new THREE.Group(),
          mat = ( ( glowLast && (k === (m - 1)) ) ? GLOW : FEATHER );
    box(f, 0.02, 0.035, len, mat, 0, 0, -(len / 2));
    f.rotation.x = 0.15 + ((k * 1.1) / Math.max(1, m - 1));
    g.add(f);
  }
  box(g, 0.03, 0.04, 0.04, GOLD, 0, 0, 0);
  g.position.set(side * 0.07, -0.13, -0.03);
  g.rotation.y = side * -0.6;
  return g;
}

// Gear on one character for the upgrades taken; returns what to remove
// when they change. Gear is added under the bones named in the model.
//
export function characterGear(model: THREE.Object3D, taken: Record<string, number>): THREE.Object3D[] {
  const out = [] as THREE.Object3D[],
        carry = taken.carry ?? 0, speed = taken.speed ?? 0,
        torso = model.getObjectByName("torso"),
        legs  = [model.getObjectByName("leg-left"), model.getObjectByName("leg-right")];
  if ( (carry > 0) && torso ) { const o = pack(carry); torso.add(o); out.push(o); }
  if (speed > 0) {
    legs.forEach((leg, k) => {
      if (!leg) { return; }
      const o = wing(speed, ( (k === 0) ? 1 : -1 ));
      leg.add(o);
      out.push(o);
    });
  }
  return out;
}

// The picture of a character upgrade on offer, its middle at the
// origin: the pack with one bundle more than taken (carry), a pair of
// wings with one feather more (speed), or a pickaxe and an axe crossed
// with one handle band more (tools), the added one glowing; null for
// other upgrades.
//
export function characterOffer(kind: string, taken: Record<string, number>): THREE.Group | null {
  const g = new THREE.Group();
  if (kind === "carry") {
    const n = (taken.carry ?? 0) + 1, o = pack(n, true);
    o.position.set(0, -(0.06 + (n * 0.06)), 0.24);
    g.add(o);
    return g;
  }
  if (kind === "tools") {
    const n = (taken.tools ?? 0) + 1;

    // Upright and crossed: each tool's handle (its inner z) turned to
    // point up and its head (inner y) across, then leaned left or right.
    //
    (["pick", "axe"] as const).forEach((t, k) => {
      const o = handTool(t), inner = o.getObjectByName("tool")!;
      inner.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
      o.position.set(0, -0.06, 0);
      o.rotation.z = ( (k === 0) ? 0.5 : -0.5 );
      o.scale.setScalar(1.5);
      toolGear(o, n, true);
      g.add(o);
    });
    return g;
  }
  if (kind === "speed") {
    for (const side of [1, -1]) {
      const o = wing((taken.speed ?? 0) + 1, side, true);
      o.position.set(side * 0.06, 0, 0.08);
      g.add(o);
    }
    return g;
  }
  return null;
}

// ---- tools ----

// The pickaxe or axe (handTool) upgraded `n` times: its head gold (the
// steel kept to put back), and n gold bands round the handle below the
// head, the last glowing if `glowLast`.
//
const steelOf = new WeakMap<THREE.Mesh, THREE.Material>();

export function toolGear(tool: THREE.Object3D, n: number, glowLast = false): void {
  const inner = tool.getObjectByName("tool");
  if (!inner) { return; }
  inner.getObjectByName("bands")?.removeFromParent();
  inner.traverse(o => {
    if ( (o.name !== "head") || !(o instanceof THREE.Mesh) ) { return; }
    if (!steelOf.has(o)) { steelOf.set(o, o.material as THREE.Material); }
    o.material = ( (n > 0) ? GOLD : steelOf.get(o)! );
  });
  const bands = new THREE.Group();
  bands.name = "bands";
  for (let k = 0; k < n; k++) {
    box(bands, 0.026, 0.026, 0.014, ( ( glowLast && (k === (n - 1)) ) ? GLOW : GOLD ), 0, 0, 0.08 - (k * 0.028));
  }
  inner.add(bands);
}

// ---- block text ----

// 3 by 5 block digits and letters, rows top to bottom.
//
const FONT: Record<string, string[]> = {
  "S": ["###", "#..", "###", "..#", "###"], "T": ["###", ".#.", ".#.", ".#.", ".#."],
  "A": ["###", "#.#", "###", "#.#", "#.#"], "R": ["##.", "#.#", "##.", "#.#", "#.#"],
  "0": ["###", "#.#", "#.#", "#.#", "###"], "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"], "3": ["###", "..#", ".##", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"], "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"], "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"], "9": ["###", "#.#", "###", "..#", "###"],
};

// Text in block characters on the x-y plane, facing +z, its middle at
// the origin; blocks of side `px`, `depth` blocks deep. Returns the group
// and its width.
//
export function blockText(text: string, px: number, m: THREE.Material, depth = 0.6): [THREE.Group, number] {
  const g = new THREE.Group(), w = (text.length * 4) - 1;
  [...text].forEach((ch, k) => {
    const rows = FONT[ch] ?? FONT["0"];
    rows.forEach((row, r) => {
      [...row].forEach((c, j) => {
        if (c === "#") { box(g, px, px, px * depth, m, (((k * 4) + j) - ((w - 1) / 2)) * px, (2 - r) * px, 0); }
      });
    });
  });
  return [g, w * px];
}

// One side of the dynamite wagon's cost: on a dark plate, a wood block
// and its number, then an ore block and its number.
//
function costPlate(wood: number, ore: number, gold: boolean, glow = false): THREE.Group {
  const g = new THREE.Group(), px = 0.035, ink = ( glow ? GLOW : ( gold ? GOLD : CREAM ) ),
        [nw, ww] = blockText(String(wood), px, ink), [no, wo] = blockText(String(ore), px, ink),
        icon = px * 3, gap = px * 1.5, sep = px * 3,
        total = icon + gap + ww + sep + icon + gap + wo;
  let x = -total / 2;
  box(g, total + (px * 2), px * 7, px * 0.4, PLATE, 0, 0, -px * 0.3);
  box(g, icon, icon, px * 0.8, WOOD, x + (icon / 2), 0, 0);
  x += icon + gap;
  nw.position.x = x + (ww / 2); g.add(nw);
  x += ww + sep;
  box(g, icon, icon, px * 0.8, ORE, x + (icon / 2), 0, 0);
  x += icon + gap;
  no.position.x = x + (wo / 2); g.add(no);
  return g;
}

// ---- wagons ----

export interface CarDims {
  length : number;
  width  : number;
  height : number;
}

// Gear on one car of the given kind; null if it has none.
//
// `glow` names an upgrade whose parts are drawn in GLOW (for an offer's
// picture).
//
export function carGear(kind: string, d: CarDims, taken: Record<string, number>, cost: [number, number], glow = ""): THREE.Group | null {
  const g = new THREE.Group(), L = d.length, W = d.width, H = d.height,
        m = (up: string, plain: THREE.Material) => ( (up === glow) ? GLOW : plain );
  if (kind === "storage") {
    for (let k = 0; k < (taken.storage ?? 0); k++) {
      for (const s of [1, -1]) { box(g, L * 0.92, 0.035, 0.025, m("storage", BOARD), 0, H + 0.02 + (k * 0.045), s * ((W / 2) - 0.012)); }
    }
  }
  else if (kind === "crafting") {
    const posts = taken.track ?? 0;
    for (let k = 0; k <= posts; k++) {
      if (posts === 0) { break; }
      const x = (-0.4 + ((0.8 * k) / posts)) * L;
      for (const s of [1, -1]) { box(g, 0.03, 0.2, 0.03, m("track", STEEL), x, H + 0.08, s * ((W / 2) + 0.01)); }
    }
    const bands = taken.craft ?? 0;
    if (bands > 0) {
      const cx = -0.44 * L;
      box(g, 0.13, 0.36, 0.13, SOOT, cx, H + 0.16, 0);
      for (let k = 0; k < bands; k++) { box(g, 0.155, 0.04, 0.155, m("craft", GOLD), cx, H + 0.06 + (k * 0.09), 0); }
    }
  }
  else if (kind === "dynamite") {
    for (const s of [1, -1]) {
      const p = costPlate(cost[0], cost[1], ((taken.cheapDynamite ?? 0) > 0), (glow === "cheapDynamite"));
      p.position.set(0, H * 0.5, s * ((W / 2) + 0.012));
      if (s < 0) { p.rotation.y = Math.PI; }
      g.add(p);
    }
  }
  return ( g.children.length ? g : null );
}
