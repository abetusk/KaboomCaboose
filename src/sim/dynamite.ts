// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Dynamite in flight or on the ground (D6.12): a lit stick put down or
// thrown, as a point that falls, bounces off the ground and off the sides
// of higher cells, and slides to a stop. Positions are in cells: x and y
// across the level, z up, in the units the page draws in (a ground
// level's top at (height + 1) * LEVEL_Y). The same steps run on the
// server and, for the throw's arc shown while aiming, on the page.
//

import { Cell, LEVEL_Y, isRamp } from "../level/cells.ts";
import type { World } from "./world.ts";

export interface Bomb {
  id   : number;
  x    : number;
  y    : number;
  z    : number;
  vx   : number;
  vy   : number;
  vz   : number;
  fuse : number;
  rest : boolean;
}

// Fall in cells per second squared; share of speed kept by a bounce, and
// of sideways speed kept on touching the ground; sideways speed lost per
// second while sliding; sub-steps per step (a fast stick then moves less
// than a cell per sub-step); height of the hand above the ground.
//
export const GRAVITY  = 20,
             BOUNCE   = 0.35,
             SLIDE    = 0.6,
             FRICTION = 6,
             SUBSTEPS = 6,
             HAND     = 0.6;

// The surface a stick lands on in the cell at (x, y): the ground (on
// grey rock its top, a level up), a tree as a block two levels tall, and
// outside the level a wall too high to pass.
//
export function floorAt(w: World, x: number, y: number): number {
  const cx = Math.floor(x), cy = Math.floor(y);
  if (!w.inside(cx, cy)) { return Infinity; }
  const i = w.idx(cx, cy), c = w.type(i), z = w.z(i);
  if (c === Cell.TREE) { return ( (z + 3) * LEVEL_Y ); }
  if (isRamp(c))       { return ( (z + 1.5) * LEVEL_Y ); }
  return ( (w.standZ(i) + 1) * LEVEL_Y );
}

// A stick thrown from (x, y) toward `heading` (radians, in the level's x
// and y) with `power` 0 to 1 of `range` (the distance on level ground at
// 45 degrees, at least one cell); power 0 puts it down at the feet.
//
export function launch(w: World, id: number, x: number, y: number, heading: number, power: number, range: number, fuse: number): Bomb {
  const f = floorAt(w, x, y);
  if (power <= 0) { return { id, x, y, z: f, vx: 0, vy: 0, vz: 0, fuse, rest: true }; }
  const r = Math.max(1, range * Math.min(1, power)), v = Math.sqrt(GRAVITY * r), h = v * Math.SQRT1_2;
  return { id, x, y, z: f + HAND, vx: h * Math.cos(heading), vy: h * Math.sin(heading), vz: h, fuse, rest: false };
}

// Move a stick on by dt seconds.
//
export function stepBomb(w: World, b: Bomb, dt: number): void {
  const ds = dt / SUBSTEPS;
  for (let k = 0; ( (k < SUBSTEPS) && !b.rest ); k++) {
    let nx = b.x + (b.vx * ds), ny = b.y + (b.vy * ds);
    b.vz -= GRAVITY * ds;
    let nz = b.z + (b.vz * ds);

    // Into a cell whose surface is above the stick: off its side.
    //
    if ( (Math.floor(nx) !== Math.floor(b.x)) && (floorAt(w, nx, b.y) > (b.z + 0.05)) ) { b.vx = -b.vx * BOUNCE; nx = b.x; }
    if ( (Math.floor(ny) !== Math.floor(b.y)) && (floorAt(w, nx, ny) > (b.z + 0.05)) ) { b.vy = -b.vy * BOUNCE; ny = b.y; }

    // Onto the ground: bounce, or once slow, lie on it and slide.
    //
    const f = floorAt(w, nx, ny);
    if (nz <= f) {
      nz = f;
      if (b.vz < 0) {
        b.vz = ( (b.vz < -1) ? (-b.vz * BOUNCE) : 0 );
        b.vx *= SLIDE; b.vy *= SLIDE;
      }
      if (b.vz <= 0) {
        b.vz = 0;
        const keep = Math.max(0, 1 - (FRICTION * ds));
        b.vx *= keep; b.vy *= keep;
        if (Math.hypot(b.vx, b.vy) < 0.2) { b.vx = 0; b.vy = 0; b.rest = true; }
      }
    }
    b.x = nx; b.y = ny; b.z = nz;
  }

  // Still lying there: the ground under it may have gone (a blast) or the
  // stick slid off an edge.
  //
  if ( b.rest && (floorAt(w, b.x, b.y) < (b.z - 0.01)) ) { b.rest = false; }
}

// Where a stick would go: its places every dt seconds until it lies
// still or `seconds` pass (the page draws this as the throw's arc).
//
export function flight(w: World, from: Bomb, dt: number, seconds: number): { x: number, y: number, z: number }[] {
  const b = { ...from }, out = [{ x: b.x, y: b.y, z: b.z }];
  for (let t = 0; ( (t < seconds) && !b.rest ); t += dt) {
    stepBomb(w, b, dt);
    out.push({ x: b.x, y: b.y, z: b.z });
  }
  return out;
}
