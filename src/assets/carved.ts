// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Carved black rock (D11.13). The carving comes from etqws3's CC0 block
// sheet (assets/third_party/etqws3): its high-contrast orange scheme has
// five colours, read as five classes. The game recolours the classes with
// its own black rock palette, and builds relief from them: holes and
// grooves (classes 0 and 1) are cut in, the rest is the raised surface.
//

export const CARVED_SOURCE = "assets/third_party/etqws3/blocks-20-textures.png";

import type { Texture } from "../vox/png.ts";

// The orange scheme's panel (4 x 4 blocks of 16 x 16) and its colours by
// class: hole, groove, base, lit edge, highlight.
//
export const CARVED_PANEL = { x: 80, y: 8 };
export const CARVED_CLASSES: [number, number, number][] = [[43, 40, 26], [30, 39, 51], [117, 81, 62], [179, 134, 39], [217, 183, 63]];

// Black rock colours for the five classes.
//
export const CARVED_PALETTE = ["#141418", "#22222c", "#3e3e4a", "#5a5a68", "#787886"];

// Relief heights in voxels by class (tools/carvevox.ts defaults), and
// the reduction factor of the class map: columns are factor x factor
// voxels, so 2 keeps the sheet's 16 x 16 pixels and 4 halves them.
//
export const CARVED_HEIGHTS = [0, 1, 2, 3, 4];
export const CARVED_FACTOR  = 2;

// Blocks used, by (row, column) in the panel: eight tops (the last the
// rare special, a carved face) and two whose halves make the sides.
//
export const CARVED_TOPS: [number, number][]  = [[0, 1], [0, 0], [1, 0], [1, 1], [2, 3], [1, 3], [1, 2], [3, 0]];
export const CARVED_SIDES: [number, number][] = [[2, 0], [2, 1]];

// The 16 blocks of the panel as class maps, row-major in the panel, each
// 256 class digits row by row.
//
export function carvedBlocks(t: Texture): string[] {
  const blocks = [] as string[];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let row = "";
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const i = 4 * (((CARVED_PANEL.y + (16 * r) + y) * t.w) + CARVED_PANEL.x + (16 * c) + x),
                k = CARVED_CLASSES.findIndex(q => ( (q[0] === t.p[i]) && (q[1] === t.p[i + 1]) && (q[2] === t.p[i + 2]) ));
          if (k < 0) { throw new Error("carved block " + r + "," + c + ": unexpected colour at " + x + "," + y); }
          row += String(k);
        }
      }
      blocks.push(row);
    }
  }
  return blocks;
}
