// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The voxel font (src/client/voxfont.ts): every glyph well formed, and
// every message the game shows in blocks drawable.
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { GLYPHS, GLYPH_H, GLYPH_GAP, drawable, lineWidth, lineBlocks } from "../src/client/voxfont.ts";
import { EMOTES } from "../src/net/protocol.ts";

test("every glyph is 5 rows of one width, of blocks and gaps only", () => {
  for (const [ch, rows] of Object.entries(GLYPHS)) {
    assert.equal(rows.length, GLYPH_H, ch);
    assert.ok(rows.every(r => ( (r.length === rows[0].length) && /^[#.]+$/.test(r) )), ch);
  }
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") { assert.ok(ch in GLYPHS, ch); }
});

test("the game's messages, emotes, countdowns and usual name characters can all be drawn", () => {
  const said = ["DERAILED", "OUT OF TIME", "ARRIVED", "RUN COMPLETE", "PICK UPGRADE", "NEXT LEVEL 12", "NEW RUN 7", "LOBBY 30",
                "LOOK AT TABLE", "X", "player_42", "Ann's (A+B): 1/2, #3 & co.", ...EMOTES];
  for (const t of said) { assert.ok(drawable(t), t); }
});

test("a line's width counts each glyph and one gap between glyphs; blocks lie inside it", () => {
  assert.equal(lineWidth("A"), 3);
  assert.equal(lineWidth("AM"), 3 + GLYPH_GAP + 5);
  assert.equal(lineWidth("a m"), 3 + 2 + 5 + (2 * GLYPH_GAP));
  const bs = lineBlocks("WOOD!");
  assert.ok(bs.every(([x, y]) => ( (x >= 0) && (x < lineWidth("WOOD!")) && (y >= 0) && (y < GLYPH_H) )));
  assert.equal(bs.length, [..."WOOD!"].reduce((s, ch) => (s + GLYPHS[ch].join("").split("#").length - 1), 0));
});
