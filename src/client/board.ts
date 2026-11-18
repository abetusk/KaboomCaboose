// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The AR board's pose on the table and how hands move it (D3.4, D3.5).
// Plain numbers in the headset's room space (metres, y up), so the
// rules can be tested without a headset. The board turns only about the
// vertical, so it stays level on the table.
//

export interface P3 {
  x : number;
  y : number;
  z : number;
}

// Board origin, turn about y (three.js rotation.y) and size of one cell
// in metres.
//
export interface BoardPose {
  x     : number;
  y     : number;
  z     : number;
  yaw   : number;
  scale : number;
}

export const SCALE_MIN = 0.004,
             SCALE_MAX = 0.2;

const clampScale = (s: number) => Math.max(SCALE_MIN, Math.min(SCALE_MAX, s));

// Turn about y that points the board's south edge (+z, the side the
// level's last rows face) at the viewer.
//
export function faceYaw(board: P3, viewer: P3): number {
  return Math.atan2(viewer.x - board.x, viewer.z - board.z);
}

// Two grabs: the board turns by how much the line between the hands
// turned about the vertical, grows or shrinks by how much the hands'
// distance changed, and keeps its place relative to the point between
// the hands. a0, b0g are the grab points when the second grab began; a,
// b are where they are now.
//
export function moveTwo(b0: BoardPose, a0: P3, b0g: P3, a: P3, b: P3): BoardPose {
  const m0 = { x: (a0.x + b0g.x) / 2, y: (a0.y + b0g.y) / 2, z: (a0.z + b0g.z) / 2 },
        m  = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 },
        d0 = Math.hypot(b0g.x - a0.x, b0g.y - a0.y, b0g.z - a0.z),
        d  = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const scale = clampScale(b0.scale * ( (d0 > 1e-3) ? (d / d0) : 1 )),
        k     = scale / b0.scale;

  // The turn only counts when the hands are apart across the floor;
  // with one hand above the other the angle is noise.
  //
  const flat0 = Math.hypot(b0g.x - a0.x, b0g.z - a0.z), flat = Math.hypot(b.x - a.x, b.z - a.z),
        t = ( ( (flat0 > 0.02) && (flat > 0.02) ) ?
              (Math.atan2(b.x - a.x, b.z - a.z) - Math.atan2(b0g.x - a0.x, b0g.z - a0.z)) : 0 );

  // Rotation about y by t, as three.js turns rotation.y: x' = x cos t +
  // z sin t, z' = -x sin t + z cos t.
  //
  const rx = b0.x - m0.x, ry = b0.y - m0.y, rz = b0.z - m0.z,
        c  = Math.cos(t), s = Math.sin(t);
  return { x     : m.x + (k * ((rx * c) + (rz * s))),
           y     : m.y + (k * ry),
           z     : m.z + (k * ((-rx * s) + (rz * c))),
           yaw   : b0.yaw + t,
           scale };
}

// Placing by looking (D3.9): the board settles where the viewer's aim
// has stayed within DWELL_RADIUS metres for DWELL_TIME seconds, so
// glancing past surfaces does not drop it but looking at the table for
// a moment does.
//
export const DWELL_RADIUS = 0.05,
             DWELL_TIME   = 1.0;

// The point the aim is held near (null before the first) and how long it
// has stayed there.
//
export interface Dwell {
  at : P3 | null;
  t  : number;
}

// Feeds this frame's aim p (null when there is none) after dt seconds;
// true once the aim has stayed put long enough.
//
export function dwell(d: Dwell, p: P3 | null, dt: number): boolean {
  if ( (!p) || (!d.at) || (Math.hypot(p.x - d.at.x, p.y - d.at.y, p.z - d.at.z) > DWELL_RADIUS) ) {
    d.at = ( p ? { ...p } : null );
    d.t  = 0;
    return false;
  }
  d.t += dt;
  return (d.t >= DWELL_TIME);
}
