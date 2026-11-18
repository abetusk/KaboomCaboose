// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Procedural voxel models for terrain cells. One cell is CELL x CELL
// voxels across and one height level is LEVEL voxels tall (half a cell,
// so ramps rise at about 27 degrees). Colours follow the Kytric "Voxel
// Path and Terrain" palette so generated blocks sit next to Kytric's
// trains, track and trees.
//
// Every generator takes a seed, so each cell can get its own variant
// (docs/DESIGN.md D4.17) and the same seed always gives the same model.
//

import { CARVED_PALETTE } from "./carved.ts";
import { BRICK_PALETTE, BRICK_CRACK } from "./bricks.ts";
import { VoxModel, type RGBA } from "../vox/vox.ts";

export const CELL  = 32;
export const LEVEL = 16;

const hex = (h: string): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

// Colour groups. Kytric's own colours where it has them.
//
const COLORS: Record<string, string[]> = {
  dirtTop   : ["#b2683d", "#ac643b", "#a66039", "#a05c37"],
  dirtSide  : ["#94532f", "#8c4f2d", "#84492a", "#7c4527"],
  forest    : ["#008f2d", "#008a2a", "#009430", "#009933"],
  pebble    : ["#787878", "#646464"],
  grey      : ["#9a9a9a", "#919191", "#888888", "#a3a3a3"],
  greyDark  : ["#7a7a7a", "#727272"],
  crack     : ["#242424", "#2c2c2c"],
  black     : ["#34343a", "#3c3c3c", "#2e2e33", "#38383e"],
  blackFleck: ["#505056", "#48484e"],
  waterTop  : ["#1684c9", "#198edd", "#2a9ae6"],
  waterDeep : ["#126da8", "#105f94"],
  plank     : ["#884c2f", "#925232", "#7e462b", "#8c5030"],
  beam      : ["#6b3b24", "#62361f"],
  nail      : ["#3c3c3c"],
  rail      : ["#646464"],
  sleeper   : ["#3c3c3c"],
  trunk     : ["#884c2f", "#7a4429"],
  rings     : ["#c08a5a"],
  bark      : ["#6e3f22", "#7a4628", "#653a1f", "#5c341c"],
  endgrain  : ["#d9a873", "#c99760", "#b9864f"],
  oreStone  : ["#6c6c70", "#606066", "#77777c", "#5a5a60"],
  oreRust   : ["#c0662a", "#d27a34", "#a85622"],
  oreShine  : ["#d8d8e0", "#c4c4cc"],
  grass     : ["#4f9a2c", "#5aa833", "#468a27", "#68b83c"],
  grassTip  : ["#8ccf55", "#9bd863"],
  flower    : ["#f2e04a", "#f2f2f2", "#e8708a"],
  dirtDry   : ["#bf7a4a", "#c78350", "#b87246"],
  loam      : ["#8a4a2a", "#7f4426", "#934f2d"],
  dirtCrack : ["#6a3a20", "#5e331c"],
  pebbleLit : ["#a0a0a0", "#8e8e8e", "#b4b0a8"],
  blackBand : ["#28282d", "#44444a", "#232328"],
  blackTip  : ["#5a5a62", "#4e4e56"],
  greyLight : ["#b4b4b4", "#aaaaaa", "#bdbdbd"],
  leafLitter: ["#c9822e", "#a85a22", "#d9a441", "#7a8a2a", "#8f4a1e"],
  bush      : ["#2f7a24", "#28701f", "#357f28", "#24661c"],
  bushLight : ["#4f9a33", "#5aa83a"],
  stem      : ["#3f7a24"],
  carved    : CARVED_PALETTE,
  brick     : [...BRICK_PALETTE, BRICK_CRACK],
};

// A palette holding every colour group, and the index of each colour.
//
const PAL: RGBA[] = [[0, 0, 0, 0]];
const IDX: Record<string, number[]> = {};
for (const [name, cs] of Object.entries(COLORS)) {
  IDX[name] = cs.map(c => { PAL.push(hex(c)); return PAL.length - 1; });
}
while (PAL.length < 256) { PAL.push([0, 0, 0, 255]); }

export function palette(): RGBA[] { return PAL.map(c => [...c] as RGBA); }

// Deterministic hash noise in [0, 1).
//
function hash(seed: number, x: number, y: number, z: number): number {
  let h = (seed * 374761393) ^ (x * 668265263) ^ (y * 2147483647) ^ (z * 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth noise: hash values on a lattice of spacing `cell`, trilinear.
//
function smooth(seed: number, x: number, y: number, z: number, cell: number): number {
  const fx = x / cell, fy = y / cell, fz = z / cell,
        ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz),
        tx = fx - ix, ty = fy - iy, tz = fz - iz;
  let v = 0;
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w = ( (dx ? tx : (1 - tx)) * (dy ? ty : (1 - ty)) * (dz ? tz : (1 - tz)) );
        v += w * hash(seed, ix + dx, iy + dy, iz + dz);
      }
    }
  }
  return v;
}

// Pick a colour from a group, mixing a smooth patch pattern with
// per-voxel speckle so surfaces vary without looking noisy.
//
function pick(group: string, seed: number, x: number, y: number, z: number): number {
  const g = IDX[group],
        t = (0.7 * smooth(seed, x, y, z, 6)) + (0.3 * hash(seed + 17, x, y, z));
  return g[Math.min(g.length - 1, Math.floor(t * g.length))];
}

function block(): VoxModel {
  return new VoxModel(CELL, CELL, LEVEL, palette());
}

// Ground: dirt with a lighter top, a few pebbles in the top layer.
//
export function ground(seed: number): VoxModel {
  const m = block();
  for (let z = 0; z < LEVEL; z++) {
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        let c = ( (z >= (LEVEL - 2)) ? pick("dirtTop", seed, x, y, z) : pick("dirtSide", seed, x, y, z) );
        if ( (z === (LEVEL - 1)) && (hash(seed + 5, x, y, 0) < 0.012) ) { c = pick("pebble", seed, x, y, z); }
        m.set(x, y, z, c);
      }
    }
  }
  return m;
}

// Forest floor: the ground block with a green top. Trees are separate
// models placed on top, so chopping can thin them out.
//
export function forestFloor(seed: number): VoxModel {
  const m = ground(seed);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      for (let z = LEVEL - 2; z < LEVEL; z++) { m.set(x, y, z, pick("forest", seed, x, y, z)); }
    }
  }
  return m;
}

// Grey rock. Light grey with patches and chipped top edges, so it reads
// as a stone block and is clearly lighter than black rock. `stage`
// 0 (intact) to 3 (about to break) adds cracks; each stage keeps the
// previous stage's cracks, so mining reads as progress. The top stays
// flat enough to walk on at every stage.
//
export const ROCK_STAGES = 4;

export function greyRock(seed: number, stage: number): VoxModel {
  const m = block();
  for (let z = 0; z < LEVEL; z++) {
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const c = ( (smooth(seed + 3, x, y, z, 9) < 0.28) ? pick("greyDark", seed, x, y, z) : pick("grey", seed, x, y, z) );
        m.set(x, y, z, c);
      }
    }
  }
  chipEdges(m, seed, 0.3);
  for (let k = 1; k <= stage; k++) { cracks(m, (seed * 31) + k, 4 + (3 * k), 14 + (8 * k)); }
  if (stage >= 3) { breakCorners(m, seed); }
  return m;
}

// Remove voxels along the top edges and vertical corners, with
// probability p, so blocks do not look machined.
//
function chipEdges(m: VoxModel, seed: number, p: number): void {
  for (let z = 0; z < m.sz; z++) {
    for (let y = 0; y < m.sy; y++) {
      for (let x = 0; x < m.sx; x++) {
        const ex = ( (x === 0) || (x === (m.sx - 1)) ),
              ey = ( (y === 0) || (y === (m.sy - 1)) ),
              top = ( z === (m.sz - 1) );
        const edge = ( (top && (ex || ey)) || (ex && ey) );
        if ( edge && (hash(seed + 11, x, y, z) < p) ) { m.set(x, y, z, 0); }
      }
    }
  }
}

// Carve n cracks on the block's visible surfaces (top and four sides),
// each a random walk of up to `len` steps. A crack removes the surface
// voxel and darkens the one behind it, so it reads as a groove.
//
function cracks(m: VoxModel, seed: number, n: number, len: number): void {
  let r = seed >>> 0;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  for (let k = 0; k < n; k++) {
    // Half the cracks go on the top face, which the game camera sees most.
    //
    const face = ( (rnd() < 0.5) ? 0 : (1 + Math.floor(rnd() * 4)) );

    // Face coordinates (u, v) and how to map them to (x, y, z), plus the
    // inward direction for darkening.
    //
    const map = (u: number, v: number): [number, number, number, number, number, number] => {
      if      (face === 0) { return [u, v, m.sz - 1, 0, 0, -1]; }
      else if (face === 1) { return [0, u, v, 1, 0, 0]; }
      else if (face === 2) { return [m.sx - 1, u, v, -1, 0, 0]; }
      else if (face === 3) { return [u, 0, v, 0, 1, 0]; }
      return [u, m.sy - 1, v, 0, -1, 0];
    };
    const um = ( (face === 0) ? m.sx : ( (face <= 2) ? m.sy : m.sx ) ),
          vm = ( (face === 0) ? m.sy : m.sz );
    let u = Math.floor(rnd() * um), v = Math.floor(rnd() * vm),
        du = ( (rnd() < 0.5) ? 1 : -1 ), dv = ( (rnd() < 0.5) ? 1 : -1 );
    for (let s = 0; s < len; s++) {
      const [x, y, z, ix, iy, iz] = map(u, v);
      if (m.get(x, y, z)) {
        m.set(x, y, z, 0);
        if (m.get(x + ix, y + iy, z + iz)) { m.set(x + ix, y + iy, z + iz, pick("crack", seed, x, y, z)); }
      }
      if (rnd() < 0.6) { u += du; } else { v += dv; }
      if (rnd() < 0.15) { du = -du; }
      if (rnd() < 0.15) { dv = -dv; }
      if ( (u < 0) || (v < 0) || (u >= um) || (v >= vm) ) { break; }
    }
  }
}

// Last mining stage: knock out rough chunks at two top corners.
//
function breakCorners(m: VoxModel, seed: number): void {
  const corners: [number, number][] = [[0, 0], [m.sx - 1, 0], [0, m.sy - 1], [m.sx - 1, m.sy - 1]];
  for (let k = 0; k < 2; k++) {
    const [cx, cy] = corners[Math.floor(hash(seed + 23, k, 0, 0) * 4)],
          r = 3 + Math.floor(hash(seed + 29, k, 0, 0) * 3);
    for (let z = m.sz - r; z < m.sz; z++) {
      for (let y = 0; y < m.sy; y++) {
        for (let x = 0; x < m.sx; x++) {
          const d = Math.hypot(x - cx, y - cy, (z - (m.sz - 1)) * 1.3);
          if (d < (r + (hash(seed, x, y, z) * 1.5))) { m.set(x, y, z, 0); }
        }
      }
    }
  }
}

// Black rock: dark and slightly blue, with lighter flecks, a few shallow
// dents in the top. Cannot be mined, so there are no stages.
//
export function blackRock(seed: number): VoxModel {
  const m = block();
  for (let z = 0; z < LEVEL; z++) {
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const fleck = ( (smooth(seed + 7, x, y, z, 4) > 0.72) && (hash(seed, x, y, z) < 0.5) );
        m.set(x, y, z, fleck ? pick("blackFleck", seed, x, y, z) : pick("black", seed, x, y, z));
      }
    }
  }
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      if (smooth(seed + 13, x, y, 0, 5) > 0.68) { m.set(x, y, LEVEL - 1, 0); }
    }
  }
  chipEdges(m, seed, 0.45);
  return m;
}

// Water: deep blue body, surface one voxel below the top of the level
// with a ripple pattern.
//
export function water(seed: number): VoxModel {
  const m = block();
  for (let z = 0; z < (LEVEL - 2); z++) {
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        let c = pick("waterDeep", seed, x, y, z);
        if (z === (LEVEL - 3)) {
          const w = Math.sin((x + (y * 0.6) + (smooth(seed, x, y, 0, 7) * 8)) * 0.7);
          c = IDX.waterTop[ (w > 0.75) ? 2 : ( (w > 0.1) ? 1 : 0 ) ];
        }
        m.set(x, y, z, c);
      }
    }
  }
  return m;
}

// Ramp: a grey rock wedge rising one level (LEVEL voxels) over one cell,
// uphill toward +x. Placed on top of the lower cell. Stepped by voxels.
//
export function ramp(seed: number): VoxModel {
  const m = block();
  for (let x = 0; x < CELL; x++) {
    const h = Math.min(LEVEL, Math.floor(((x + 1) * LEVEL) / CELL) + 1);
    for (let y = 0; y < CELL; y++) {
      for (let z = 0; z < h; z++) {
        const c = ( (smooth(seed + 3, x, y, z, 9) < 0.28) ? pick("greyDark", seed, x, y, z) : pick("grey", seed, x, y, z) );
        m.set(x, y, z, c);
      }
    }
  }
  for (let x = 0; x < CELL; x++) {
    for (const y of [0, CELL - 1]) {
      for (let z = 0; z < LEVEL; z++) {
        if ( m.get(x, y, z) && !m.get(x, y, z + 1) && (hash(seed + 41, x, y, z) < 0.4) ) { m.set(x, y, z, 0); }
      }
    }
  }
  return m;
}

// Scale a model up by an integer factor (each voxel becomes f x f x f).
//
export function scaleUp(src: VoxModel, f: number): VoxModel {
  const m = new VoxModel(src.sx * f, src.sy * f, src.sz * f, src.pal);
  for (let z = 0; z < src.sz; z++) {
    for (let y = 0; y < src.sy; y++) {
      for (let x = 0; x < src.sx; x++) {
        const c = src.get(x, y, z);
        if (!c) { continue; }
        for (let k = 0; k < (f * f * f); k++) {
          m.set((x * f) + (k % f), (y * f) + (Math.floor(k / f) % f), (z * f) + Math.floor(k / (f * f)), c);
        }
      }
    }
  }
  return m;
}

// Train scale relative to Kytric's models. Track gauge follows it.
//
export const TRAIN_SCALE = 2;

// Track geometry, centred in the cell. At Kytric's scale the rails are
// 5 voxels apart (centre to centre) and one voxel wide, with sleepers
// reaching one voxel past each rail; all scaled by TRAIN_SCALE. A train
// scaled the same way sits with its outer wheel rows on the rails when
// its first row is at TRACK_Y0. Sleepers are the bottom voxel and rails
// the top one, so the steel sits on the wood (D6a.26); the train rides
// TRACK_H voxels up, on the rail tops.
//
const RAIL_W   = TRAIN_SCALE,
      GAUGE    = 5 * TRAIN_SCALE,
      TRACK_Y0 = Math.floor((CELL - (GAUGE + RAIL_W)) / 2),
      TRACK_H  = TRAIN_SCALE;

export const TRACK_TOP = TRACK_H;

export const TRAIN_Y = TRACK_Y0;

// Straight track along x: rails at TRACK_Y0 and TRACK_Y0 + GAUGE, sleepers
// two (scaled) voxels wide every four, Kytric's pattern.
//
export function trackStraight(): VoxModel {
  const m = new VoxModel(CELL, CELL, TRACK_H, palette()),
        y0 = TRACK_Y0, y1 = TRACK_Y0 + GAUGE;
  for (let x = 0; x < CELL; x++) {
    const sleeper = ( ((Math.floor(x / TRAIN_SCALE) % 4) === 1) || ((Math.floor(x / TRAIN_SCALE) % 4) === 2) );
    for (let y = y0 - TRAIN_SCALE; y < (y1 + RAIL_W + TRAIN_SCALE); y++) {
      const rail = ( ((y >= y0) && (y < (y0 + RAIL_W))) || ((y >= y1) && (y < (y1 + RAIL_W))) );
      if (sleeper) { m.set(x, y, 0, IDX.sleeper[0]); }
      if (rail)    { m.set(x, y, TRACK_H - 1, IDX.rail[0]); }
    }
  }
  return m;
}

// Quarter-turn track: enters at the west edge (x = 0) and leaves at the
// south edge (y = CELL - 1), turning about the cell's south-west corner.
// Rails follow arcs at the same gauge as straight track; sleepers are
// radial.
//
export function trackCurve(): VoxModel {
  const m  = new VoxModel(CELL, CELL, TRACK_H, palette()),
        cx = 0, cy = CELL,
        r0 = CELL - (TRACK_Y0 + GAUGE + RAIL_W),
        r1 = CELL - TRACK_Y0;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const px = (x + 0.5) - cx, py = cy - (y + 0.5),
            r  = Math.hypot(px, py),
            a  = Math.atan2(py, px);
      if ( (r < (r0 - TRAIN_SCALE)) || (r >= (r1 + TRAIN_SCALE)) ) { continue; }
      const rail = ( ((r >= r0) && (r < (r0 + RAIL_W))) || ((r >= (r1 - RAIL_W)) && (r < r1)) );

      // Sleepers: same spacing as straight track, measured along the
      // centre line.
      //
      const along   = a * ((r0 + r1) / 2),
            k       = Math.floor(along / TRAIN_SCALE) % 4,
            sleeper = ( (k === 1) || (k === 2) );
      if (sleeper) { m.set(x, y, 0, IDX.sleeper[0]); }
      if (rail)    { m.set(x, y, TRACK_H - 1, IDX.rail[0]); }
    }
  }
  return m;
}

// Track on a ramp: a straight track model (rails along x) sheared up the
// ramp's slope, uphill toward +x. Sits on the ramp's surface.
//
export function slopedTrack(flat: VoxModel): VoxModel {
  const m = new VoxModel(flat.sx, flat.sy, LEVEL + flat.sz, flat.pal);
  for (let z = 0; z < flat.sz; z++) {
    for (let y = 0; y < flat.sy; y++) {
      for (let x = 0; x < flat.sx; x++) {
        const c = flat.get(x, y, z);
        if (!c) { continue; }
        const lift = Math.min(LEVEL, Math.floor(((x + 1) * LEVEL) / CELL) + 1);
        m.set(x, y, z + lift, c);
        m.set(x, y, z + lift - 1, c);
      }
    }
  }
  return m;
}

// Bridge deck: planks across the direction of travel (x), on two beams,
// occupying the top of a level. Each plank gets its own shade.
//
export function bridge(seed: number): VoxModel {
  const m = block();
  const plankW = 4;
  for (let x = 0; x < CELL; x++) {
    const plank = Math.floor(x / plankW),
          shade = IDX.plank[Math.floor(hash(seed, plank, 0, 0) * IDX.plank.length)],
          edge  = ( (x % plankW) === (plankW - 1) );
    for (let y = 0; y < CELL; y++) {
      const ragged = ( (y === 0) || (y === (CELL - 1)) ) && (hash(seed + 3, plank, y, 0) < 0.5);
      if (ragged) { continue; }
      m.set(x, y, LEVEL - 1, ( edge ? IDX.beam[0] : shade ));
      m.set(x, y, LEVEL - 2, shade);
      if ( ( (y === 4) || (y === (CELL - 5)) ) && ((x % plankW) === 1) ) { m.set(x, y, LEVEL - 1, IDX.nail[0]); }
    }
  }
  for (let x = 0; x < CELL; x++) {
    for (const y0 of [3, CELL - 6]) {
      for (let y = y0; y < (y0 + 3); y++) {
        for (let z = LEVEL - 5; z < (LEVEL - 2); z++) { m.set(x, y, z, pick("beam", seed, x, y, z)); }
      }
    }
  }
  return m;
}

// Tree stump left after chopping.
//
export function stump(seed: number): VoxModel {
  const m = new VoxModel(4, 4, 3, palette());
  for (let z = 0; z < 3; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const corner = ( ((x === 0) || (x === 3)) && ((y === 0) || (y === 3)) );
        if (corner) { continue; }
        m.set(x, y, z, ( (z === 2) && (x > 0) && (x < 3) && (y > 0) && (y < 3) ) ? IDX.rings[0] : pick("trunk", seed, x, y, z));
      }
    }
  }
  return m;
}

// Tree positions in a forest cell: a jittered 3 x 3 grid, in the order
// trees are removed while chopping (the last ones left are spread out).
//
export function treeSpots(seed: number): [number, number][] {
  const spots = [] as [number, number][];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      spots.push([ 2 + (i * 10) + Math.floor(hash(seed, i, j, 1) * 4),
                   2 + (j * 10) + Math.floor(hash(seed, i, j, 2) * 4) ]);
    }
  }
  const order = [4, 0, 8, 2, 6, 1, 7, 3, 5];
  return order.map(k => spots[k]).reverse();
}

// Carried and stacked items (D6a.7): cubes half a cell on a side, so
// they keep one size in piles and in hands.
//
export const ITEM = 16;

// Wood: a block of log, bark on the sides, end grain with rings on the
// two ends (faces +-x).
//
export function woodCube(seed: number): VoxModel {
  const m = new VoxModel(ITEM, ITEM, ITEM, palette()), c = (ITEM - 1) / 2;
  for (let z = 0; z < ITEM; z++) {
    for (let y = 0; y < ITEM; y++) {
      for (let x = 0; x < ITEM; x++) {
        const end  = ( (x === 0) || (x === (ITEM - 1)) ),
              r    = Math.hypot(y - c, z - c),
              edge = ( (y === 0) || (z === 0) || (y === (ITEM - 1)) || (z === (ITEM - 1)) );
        if (end && !edge) { m.set(x, y, z, IDX.endgrain[Math.floor(r / 2) % IDX.endgrain.length]); }
        else              { m.set(x, y, z, pick("bark", seed, x, y, z)); }
      }
    }
  }
  return m;
}

// Ore: grey stone with rust-orange streaks and a few bright flecks.
//
export function oreCube(seed: number): VoxModel {
  const m = new VoxModel(ITEM, ITEM, ITEM, palette());
  for (let z = 0; z < ITEM; z++) {
    for (let y = 0; y < ITEM; y++) {
      for (let x = 0; x < ITEM; x++) {
        const h = hash(seed + 5, x, y, z), vein = smooth(seed + 9, x, y, z, 4);
        let c = pick("oreStone", seed, x, y, z);
        if (vein > 0.68) { c = pick("oreRust", seed + 3, x, y, z); }
        if (h > 0.965)   { c = IDX.oreShine[Math.floor(h * 100) % 2]; }
        m.set(x, y, z, c);
      }
    }
  }
  return m;
}

// A tuft of grass, a few blades of different heights, sometimes with a
// flower; scattered on ground cells for variety.
//
export function grassTuft(seed: number): VoxModel {
  const m = new VoxModel(6, 6, 6, palette());
  const n = 4 + Math.floor(hash(seed, 1, 2, 3) * 5);
  for (let k = 0; k < n; k++) {
    const x = Math.floor(hash(seed, k, 7, 1) * 6), y = Math.floor(hash(seed, k, 8, 2) * 6),
          h = 2 + Math.floor(hash(seed, k, 9, 3) * 4);
    for (let z = 0; z < h; z++) { m.set(x, y, z, ( (z === (h - 1)) ? pick("grassTip", seed, x, y, z) : pick("grass", seed, x, y, z) )); }
    if ( (k === 0) && (hash(seed, 4, 4, 4) > 0.6) ) { m.set(x, y, h, IDX.flower[Math.floor(hash(seed, 5, 5, 5) * 3)]); }
  }
  return m;
}

// ---- visual extras (D11.11) ----

// Ground with a detailed top: dirt in three tones mottled at a few
// voxels' scale, darker loam blotches, small pebble clusters with a lit
// side, and a few thin cracks. The sides are plain ground.
//
export function groundDetail(seed: number): VoxModel {
  const m = ground(seed), z = LEVEL - 1;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const t = (0.65 * smooth(seed + 51, x, y, 0, 3)) + (0.35 * smooth(seed + 52, x, y, 0, 9)),
            l = smooth(seed + 53, x, y, 0, 7);
      let c = ( (t > 0.6) ? pick("dirtDry", seed, x, y, z) : pick("dirtTop", seed, x, y, z) );
      if (l > 0.7) { c = pick("loam", seed, x, y, z); }
      m.set(x, y, z, c);
      m.set(x, y, z - 1, c);
    }
  }

  // Pebble clusters: 2 to 4 groups of 1 to 4 stones, each stone 1 to 3
  // voxels across, darker on its south-east side.
  //
  const groups = 2 + Math.floor(hash(seed, 61, 0, 0) * 3);
  for (let gi = 0; gi < groups; gi++) {
    const gx = 3 + Math.floor(hash(seed, 62, gi, 0) * (CELL - 6)), gy = 3 + Math.floor(hash(seed, 63, gi, 0) * (CELL - 6)),
          n  = 1 + Math.floor(hash(seed, 64, gi, 0) * 4);
    for (let k = 0; k < n; k++) {
      const px = gx + Math.floor((hash(seed, 65, gi, k) - 0.5) * 6), py = gy + Math.floor((hash(seed, 66, gi, k) - 0.5) * 6),
            r  = 1 + Math.floor(hash(seed, 67, gi, k) * 3);
      for (let dy = 0; dy < r; dy++) {
        for (let dx = 0; dx < r; dx++) {
          const x = px + dx, y = py + dy;
          if ( (x < 0) || (y < 0) || (x >= CELL) || (y >= CELL) ) { continue; }
          if ( (r === 3) && ((dx !== 1) && (dy !== 1)) ) { continue; }
          const shade = ( ((dx === (r - 1)) || (dy === (r - 1))) && (r > 1) );
          m.set(x, y, z, ( shade ? pick("pebble", seed, x, y, z) : pick("pebbleLit", seed, x, y, z) ));
        }
      }
    }
  }

  // A few thin cracks: short random walks in dark dirt.
  //
  const cracksN = Math.floor(hash(seed, 71, 0, 0) * 3);
  for (let k = 0; k < cracksN; k++) {
    let x = Math.floor(hash(seed, 72, k, 0) * CELL), y = Math.floor(hash(seed, 73, k, 0) * CELL);
    const dx = ( (hash(seed, 74, k, 0) < 0.5) ? 1 : -1 ), dy = ( (hash(seed, 75, k, 0) < 0.5) ? 1 : -1 );
    for (let s = 0; s < 9; s++) {
      if ( (x < 0) || (y < 0) || (x >= CELL) || (y >= CELL) ) { break; }
      m.set(x, y, z, pick("dirtCrack", seed, x, y, z));
      if (hash(seed, 76, k, s) < 0.6) { x += dx; } else { y += dy; }
    }
  }
  return m;
}

// Black rock with strata: wavy horizontal bands of darker and lighter
// rock on the sides, so mountain walls read as layered stone.
//
export function blackStrata(seed: number): VoxModel {
  const m = blackRock(seed);
  for (let z = 0; z < LEVEL; z++) {
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        if (!m.get(x, y, z)) { continue; }
        const wob = (smooth(seed + 81, x, y, 0, 8) - 0.5) * 4,
              band = Math.floor((z + wob + 32) / 4) % 3;
        if (band === 1) { m.set(x, y, z, IDX.blackBand[0]); }
        else if ( (band === 2) && (((z + Math.round(wob) + 32) % 4) === 0) ) { m.set(x, y, z, IDX.blackBand[1]); }
      }
    }
  }
  return m;
}

// A boulder: a lumpy ellipsoid with a flat bottom, radius r voxels across
// and about 0.7 r tall, mottled grey, lighter on top, with a crack or two.
//
export function boulder(seed: number, r: number): VoxModel {
  const n = Math.ceil(2 * r) + 3, h = Math.max(3, Math.round(r * 1.3)), m = new VoxModel(n, n, h, palette()), c0 = (n - 1) / 2,
        rx = r * (0.8 + (0.25 * hash(seed, 93, 0, 0))), ry = r * (0.65 + (0.25 * hash(seed, 94, 0, 0))),
        sh = (hash(seed, 95, 0, 0) - 0.5) * 0.5;
  for (let z = 0; z < h; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = (x - c0) / rx, dy = (y - c0) / ry, dz = z / (h - 0.5),
              ex = dx + (sh * dz),
              bump = ((smooth(seed + 91, x, y, z, Math.max(2, r / 3)) - 0.5) * 0.8) + ((smooth(seed + 96, x, y, z, Math.max(3, r)) - 0.5) * 0.5);
        if (((ex * ex) + (dy * dy) + (dz * dz)) > (1 + bump)) { continue; }
        const top = (dz > 0.62);
        let c = ( (smooth(seed + 3, x, y, z, 4) < 0.3) ? pick("greyDark", seed, x, y, z) : pick("grey", seed, x, y, z) );
        if ( top && (hash(seed + 92, x, y, z) < 0.55) ) { c = pick("greyLight", seed, x, y, z); }
        m.set(x, y, z, c);
      }
    }
  }
  cracks(m, seed * 7, 1 + Math.floor(r / 3), Math.round(r) + 3);
  return m;
}

// A crag: a jagged tapering spire of black rock h voxels tall, its axis
// leaning a little, lighter at the tip.
//
export function crag(seed: number, h: number, r0: number): VoxModel {
  const n = (2 * r0) + 5, m = new VoxModel(n, n, h, palette()), c0 = (n - 1) / 2,
        lx = (hash(seed, 101, 0, 0) - 0.5) * 0.25, ly = (hash(seed, 102, 0, 0) - 0.5) * 0.25;
  for (let z = 0; z < h; z++) {
    const t = z / h, r = (r0 * Math.pow(1 - t, 0.85)) + 0.6, ax = c0 + (lx * z), ay = c0 + (ly * z);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x - ax, y - ay), jag = (smooth(seed + 103, x, y, z, 2.5) - 0.5) * 2.2;
        if (d > (r + jag)) { continue; }
        const fleck = (smooth(seed + 7, x, y, z, 3) > 0.72);
        m.set(x, y, z, ( (t > 0.8) ? pick("blackTip", seed, x, y, z) : ( fleck ? pick("blackFleck", seed, x, y, z) : pick("black", seed, x, y, z) ) ));
      }
    }
  }
  return m;
}

// Ground details, scattered like grass: a few stones; a small patch of
// flowers; fallen leaves (near forests); gravel (near grey rock); a bush
// (in gaps between trees).
//
export function pebbles(seed: number): VoxModel {
  const m = new VoxModel(10, 10, 3, palette()), n = 2 + Math.floor(hash(seed, 1, 0, 0) * 3);
  for (let k = 0; k < n; k++) {
    const px = Math.floor(hash(seed, 2, k, 0) * 8), py = Math.floor(hash(seed, 3, k, 0) * 8), r = 1 + Math.floor(hash(seed, 4, k, 0) * 2.5);
    for (let z = 0; z < Math.min(3, r); z++) {
      for (let dy = 0; dy < r; dy++) {
        for (let dx = 0; dx < r; dx++) {
          if ( (z === (r - 1)) && (r > 1) && ((dx === 0) || (dy === 0)) ) { continue; }
          m.set(Math.min(9, px + dx), Math.min(9, py + dy), z, ( (z === (Math.min(3, r) - 1)) ? pick("pebbleLit", seed, px, py, z) : pick("pebble", seed, px, py, z) ));
        }
      }
    }
  }
  return m;
}

export function flowers(seed: number): VoxModel {
  const m = new VoxModel(8, 8, 5, palette()), n = 3 + Math.floor(hash(seed, 1, 0, 0) * 3),
        col = IDX.flower[Math.floor(hash(seed, 9, 0, 0) * 3)];
  for (let k = 0; k < n; k++) {
    const x = Math.floor(hash(seed, 2, k, 0) * 8), y = Math.floor(hash(seed, 3, k, 0) * 8), h = 2 + Math.floor(hash(seed, 4, k, 0) * 3);
    for (let z = 0; z < h; z++) { m.set(x, y, z, IDX.stem[0]); }
    m.set(x, y, Math.min(4, h), col);
  }
  return m;
}

export function leaves(seed: number): VoxModel {
  const m = new VoxModel(16, 16, 1, palette());
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (hash(seed, x, y, 1) < (0.14 + (0.12 * smooth(seed, x, y, 0, 4)))) { m.set(x, y, 0, pick("leafLitter", seed, x, y, 0)); }
    }
  }
  return m;
}

export function gravel(seed: number): VoxModel {
  const m = new VoxModel(16, 16, 2, palette());
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 8;
      if (hash(seed, x, y, 1) < (0.45 * (1 - d))) {
        m.set(x, y, 0, pick("pebble", seed, x, y, 0));
        if (hash(seed, x, y, 2) < 0.25) { m.set(x, y, 1, pick("pebbleLit", seed, x, y, 1)); }
      }
    }
  }
  return m;
}

export function bush(seed: number): VoxModel {
  const n = 12, h = 9, m = new VoxModel(n, n, h, palette()), c0 = (n - 1) / 2;
  for (let z = 0; z < h; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = (x - c0) / 5.5, dy = (y - c0) / 5.5, dz = (z - 2) / 6.5,
              bump = (smooth(seed + 5, x, y, z, 2) - 0.5) * 0.6;
        if (((dx * dx) + (dy * dy) + (dz * dz)) > (1 + bump)) { continue; }
        m.set(x, y, z, ( ( (z >= (h - 4)) && (hash(seed, x, y, z) < 0.5) ) ? pick("bushLight", seed, x, y, z) : pick("bush", seed, x, y, z) ));
      }
    }
  }
  return m;
}

// ---- face pieces (D11.12) ----
//
// Small pieces stuck on exposed block sides: x runs along the face, y is
// the thin depth (2 voxels, half of it sunk in the wall), z is up.

// A vine hanging from a wall's top edge: two or three strands of leaves
// of different lengths, lit leaves along each strand.
//
export function vine(seed: number): VoxModel {
  const m = new VoxModel(9, 2, 14, palette()), n = 2 + Math.floor(hash(seed, 1, 0, 0) * 2);
  for (let k = 0; k < n; k++) {
    const x = 1 + (k * 3) + Math.floor(hash(seed, 2, k, 0) * 2), len = 6 + Math.floor(hash(seed, 3, k, 0) * 8);
    for (let d = 0; d < len; d++) {
      const z = 13 - d, wig = ( ((d % 4) === 1) ? 1 : ( ((d % 4) === 3) ? -1 : 0 ) ), c = ( ((d % 3) === 0) ? IDX.grassTip[0] : IDX.bush[d % 4] );
      m.set(Math.max(0, Math.min(8, x + wig)), 0, z, c);
      m.set(Math.max(0, Math.min(8, x + wig)), 1, z, c);
    }
  }
  return m;
}

// A stone sticking out of a dirt side: 4 to 6 voxels wide, 3 tall, lit
// on top.
//
export function sideStone(seed: number): VoxModel {
  const w = 4 + Math.floor(hash(seed, 1, 0, 0) * 3), m = new VoxModel(w, 2, 3, palette());
  for (let z = 0; z < 3; z++) {
    for (let x = 0; x < w; x++) {
      if ( (z === 2) && ((x === 0) || (x === (w - 1))) ) { continue; }
      const c = ( (z === 2) ? IDX.pebbleLit[0] : ( (z === 0) ? IDX.pebble[1] : IDX.pebble[0] ) );
      m.set(x, 0, z, c); m.set(x, 1, z, c);
    }
  }
  return m;
}

// Grass hanging over a forest ledge: a short fringe of blades, 2 to 5
// voxels long, along the top edge.
//
export function grassFringe(seed: number): VoxModel {
  const m = new VoxModel(12, 2, 6, palette());
  for (let x = 0; x < 12; x++) {
    if (hash(seed, x, 1, 0) < 0.3) { continue; }
    const len = 2 + Math.floor(hash(seed, x, 2, 0) * 4);
    for (let d = 0; d < len; d++) {
      const c = ( (d === 0) ? IDX.grassTip[x % 2] : IDX.grass[(x + d) % 4] );
      m.set(x, 0, 5 - d, c); m.set(x, 1, 5 - d, c);
    }
  }
  return m;
}

// A carved relief block (D11.13), made by tools/carvevox.ts: a 16 x 16
// class map reduced by `factor` (relative to the 32-voxel cell, so 2
// keeps the map's 16 columns and 4 merges 2 x 2 pixels into one) and
// raised as a heightfield. Each column is factor x factor voxels and
// heights[class] voxels tall, coloured by class; class heights of 0
// leave the textured top beneath showing.
//
export function carvedRelief(classes: number[], factor: number, heights: number[]): VoxModel {
  const n = CELL / factor, m = new VoxModel(CELL, CELL, Math.max(1, ...heights), palette());
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const k = carvedClass(classes, n, cx, cy), hz = heights[k];
      for (let z = 0; z < hz; z++) {
        for (let y = cy * factor; y < ((cy + 1) * factor); y++) {
          for (let x = cx * factor; x < ((cx + 1) * factor); x++) { m.set(x, y, z, IDX.carved[k]); }
        }
      }
    }
  }
  return m;
}

// The class of column (cx, cy) when a 16 x 16 class map is reduced to
// n x n: the most common class among the pixels it covers, ties going
// to the lower class so thin grooves survive.
//
export function carvedClass(classes: number[], n: number, cx: number, cy: number): number {
  const f = 16 / n, count = [0, 0, 0, 0, 0];
  for (let y = cy * f; y < ((cy + 1) * f); y++) {
    for (let x = cx * f; x < ((cx + 1) * f); x++) { count[classes[(y * 16) + x]]++; }
  }
  let best = 0;
  for (let k = 1; k < 5; k++) { if (count[k] > count[best]) { best = k; } }
  return best;
}

// Palette index of brick class k (joint, stone face, lit edge, crack).
//
export function brickColourIndex(k: number): number { return IDX.brick[k]; }
