// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Positions along the train's line. Distance p is measured in cells: the
// centre of the line's k-th cell is at p = k. Within a cell the path runs
// from the middle of the edge it enters by to the middle of the edge it
// leaves by: a straight line, or a quarter circle of radius 1/2 round the
// corner between those edges on a curve.
//

import { DIRS, isRamp } from "../level/cells.ts";
import { World, opposite } from "./world.ts";

export interface Pose {
  x       : number;
  y       : number;
  z       : number;
  heading : number;
}

// Pose at distance p along `line`. Beyond either end the path carries on
// straight.
//
export function poseAt(w: World, line: number[], p: number): Pose {
  const n = line.length;
  if (!n) { return { x: 0, y: 0, z: 0, heading: 0 }; }
  const k  = Math.max(0, Math.min(n - 1, Math.round(p))),
        i  = line[k],
        [cx, cy] = w.xy(i);

  // Exit and entry directions of cell k, continuing straight at the ends.
  //
  let exit  = ( (k < (n - 1)) ? w.dirTo(i, line[k + 1]) : -1 ),
      entry = ( (k > 0) ? w.dirTo(i, line[k - 1]) : -1 );
  if ( (exit < 0) && (entry < 0) ) { exit = 1; }
  if (exit < 0)  { exit = opposite(entry); }
  if (entry < 0) { entry = opposite(exit); }

  const t  = p - (k - 0.5),
        ox = cx + 0.5, oy = cy + 0.5,
        ex = DIRS[entry], xx = DIRS[exit];
  let x: number, y: number, hx: number, hy: number;
  if (exit === opposite(entry)) {
    x  = ox + (ex[0] * 0.5) + ((xx[0] - ex[0]) * 0.5 * t);
    y  = oy + (ex[1] * 0.5) + ((xx[1] - ex[1]) * 0.5 * t);
    hx = xx[0]; hy = xx[1];
  }
  else {
    // Quarter circle round the corner shared by the entry and exit edges.
    //
    const qx = ox + (0.5 * (ex[0] + xx[0])), qy = oy + (0.5 * (ex[1] + xx[1])),
          a0 = Math.atan2(-xx[1], -xx[0]), a1 = Math.atan2(-ex[1], -ex[0]);
    let da = a1 - a0;
    if (da > Math.PI)  { da -= 2 * Math.PI; }
    if (da < -Math.PI) { da += 2 * Math.PI; }
    const a = a0 + (da * t);
    x  = qx + (0.5 * Math.cos(a));
    y  = qy + (0.5 * Math.sin(a));
    hx = -Math.sin(a) * Math.sign(da); hy = Math.cos(a) * Math.sign(da);
  }

  // Height: the cell's level, rising across a ramp toward its uphill side.
  //
  let z = w.z(i);
  if (isRamp(w.type(i))) {
    const d = w.g.dir[i], u = ( (d === 1) ? (x - cx) : ( (d === 3) ? ((cx + 1) - x) : ( (d === 2) ? (y - cy) : ((cy + 1) - y) ) ) );
    z += Math.max(0, Math.min(1, u));
  }
  return { x, y, z, heading: Math.atan2(hy, hx) };
}

// A rigid car on the line (D6a.26): it rests on the track at its two
// wheel points, `wheelbase` cells apart along the line about distance
// `mid`, so on a bend it cuts across the inside instead of bending. The
// body's centre is midway between the wheels; it heads from the rear
// wheel to the front one, and tilts by their difference in height.
//
export interface CarPose extends Pose {
  front : Pose;
  rear  : Pose;
}

export function carPose(w: World, line: number[], mid: number, wheelbase: number): CarPose {
  const front = poseAt(w, line, mid + (wheelbase / 2)), rear = poseAt(w, line, mid - (wheelbase / 2)),
        dx = front.x - rear.x, dy = front.y - rear.y,
        heading = ( (Math.hypot(dx, dy) > 1e-6) ? Math.atan2(dy, dx) : poseAt(w, line, mid).heading );
  return { x: (front.x + rear.x) / 2, y: (front.y + rear.y) / 2, z: (front.z + rear.z) / 2, heading, front, rear };
}
