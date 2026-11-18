// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The station building: mehrasaur's Voxel Buildings model 10 (CC0;
// https://opengameart.org/content/voxel-buildings), the small cafe with
// a blue awning. Its green ground plate is left out (the level's own
// ground is under it), it is cropped to the building, turned so its
// front faces +y (the track) and scaled 2x.
//

import { VoxModel, readVox } from "../vox/vox.ts";
import { scaleUp } from "./terrain.ts";

// Crop a model to its occupied box.
//
export function crop(m: VoxModel): VoxModel {
  const lo = [Infinity, Infinity, Infinity], hi = [-1, -1, -1];
  for (let z = 0; z < m.sz; z++) {
    for (let y = 0; y < m.sy; y++) {
      for (let x = 0; x < m.sx; x++) {
        if (!m.get(x, y, z)) { continue; }
        [x, y, z].forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); });
      }
    }
  }
  const out = new VoxModel((hi[0] - lo[0]) + 1, (hi[1] - lo[1]) + 1, (hi[2] - lo[2]) + 1, m.pal);
  for (let z = lo[2]; z <= hi[2]; z++) {
    for (let y = lo[1]; y <= hi[1]; y++) {
      for (let x = lo[0]; x <= hi[0]; x++) { out.set(x - lo[0], y - lo[1], z - lo[2], m.get(x, y, z)); }
    }
  }
  return out;
}

export const HOUSE_SCALE = 2;

// Rows of the source model that are its ground plate (z 0 and 1).
//
const PLATE = 2;

// 56 x 56 x 48 voxels at HOUSE_SCALE 2: 1.75 cells square and 1.5 cells
// tall. The source's front (awning, door) faces -y; turned 180 degrees
// about z it faces +y.
//
export function stationHouse(path: string): VoxModel {
  const src = readVox(path),
        top = new VoxModel(src.sx, src.sy, src.sz - PLATE, src.pal);
  for (let z = PLATE; z < src.sz; z++) {
    for (let y = 0; y < src.sy; y++) {
      for (let x = 0; x < src.sx; x++) { top.set((src.sx - 1) - x, (src.sy - 1) - y, z - PLATE, src.get(x, y, z)); }
    }
  }
  return scaleUp(crop(top), HOUSE_SCALE);
}
