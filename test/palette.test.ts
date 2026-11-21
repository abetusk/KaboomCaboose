// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Level palettes (src/client/palette.ts, view.palette).
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE_COUNT, KINDS, BASE, byKind, multiplier, linear, levelAt, paletteIndex, levelColours } from "../src/client/palette.ts";

test("500 palettes; each level's palette is fixed by the seed; colours go to kinds darkest first", () => {
  assert.equal(PALETTE_COUNT, 500);
  assert.equal(paletteIndex(1, 3), paletteIndex(1, 3));
  assert.notDeepEqual([0, 1, 2, 3].map(k => paletteIndex(1, k)), [0, 1, 2, 3].map(k => paletteIndex(2, k)));
  const lum = (h: string) => { const [r, g, b] = linear(h); return ( (0.2126 * r) + (0.7152 * g) + (0.0722 * b) ); };
  for (let p = 0; p < PALETTE_COUNT; p += 37) {
    const c = byKind(p);
    for (let k = 1; k < KINDS.length; k++) { assert.ok(lum(c[KINDS[k - 1]]) <= lum(c[KINDS[k]])); }
  }
});

test("a multiplier takes the surface's usual colour to the palette's (within its hold); strength 0 changes nothing", () => {
  const m = multiplier(BASE.ground, "#507090", 1), b = linear(BASE.ground), t = linear("#507090");
  for (let c = 0; c < 3; c++) { assert.ok(Math.abs((b[c] * m[c]) - t[c]) < 1e-9); }
  assert.equal(multiplier(BASE.black, "#ffffff", 1)[0], 12, "held to 12");
  assert.deepEqual(multiplier(BASE.ground, "#3366cc", 0), [1, 1, 1]);
  assert.ok(levelColours(3, 1, 1).length === 3);
});

test("cells take their level's palette, mixing across the band around each station between levels", () => {
  const mids = [20, 50], blend = 10, share = (x: number) => {
    let n = 0;
    for (let key = 0; key < 2000; key++) { n += levelAt(x, mids, blend, key); }
    return n / 2000;
  };
  assert.equal(share(5), 0);
  assert.equal(share(30), 1);
  assert.equal(share(70), 2);
  const a = share(16), b = share(19), c = share(23);
  assert.ok( (0 < a) && (a < b) && (b < c) && (c < 1), [a, b, c].join(" ") );
  assert.equal(levelAt(18, mids, 0, 7), 0, "no band: a sharp edge");
  assert.equal(levelAt(21, mids, 0, 7), 1);
});
