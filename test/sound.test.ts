// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// What plays when (config/sounds.json, src/client/sound.ts): every cue
// set, every file there, and a bad file refused on load.
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { SOUNDS, CUES, soundConfig, passed } from "../src/client/sound.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

test("config/sounds.json sets every cue, and every file it names is in the repo", () => {
  assert.deepEqual(Object.keys(SOUNDS.sounds).sort(), [...CUES].sort());
  for (const [cue, c] of Object.entries(SOUNDS.sounds)) {
    for (const f of c.files) { assert.ok(existsSync(join(ROOT, SOUNDS.folder, f)), cue + ": " + f); }
  }
});

test("a sounds file missing a cue, with no files for one, or naming an unknown one is refused", () => {
  const good = { folder: "x/", sounds: Object.fromEntries(CUES.map(c => [c, { files: ["a.mp3"] }])) };
  assert.equal(soundConfig(good).sounds.mine.volume, 1, "volume defaults to 1");
  const { mine: _, ...noMine } = good.sounds;
  assert.throws(() => soundConfig({ ...good, sounds: noMine }), /sounds.mine is missing/);
  assert.throws(() => soundConfig({ ...good, sounds: { ...good.sounds, chop: { files: [] } } }), /chop.files/);
  assert.throws(() => soundConfig({ ...good, sounds: { ...good.sounds, whistle: { files: ["w.mp3"] } } }), /whistle is not a cue/);
});

test("a swing's strike is caught once per loop, also when the frame wraps round the loop", () => {
  const d = 0.4, at = 0.56 * d;
  let was = 0, n = 0;
  for (let t = 0.03; t < (10 * d); t += 0.03) {
    const now = t % d;
    if (passed(was, now, at)) { n++; }
    was = now;
  }
  assert.equal(n, 10);
  assert.ok(passed(0.38, 0.25, 0.224), "wrapped past it");
  assert.ok(!passed(0.30, 0.10, 0.224), "wrapped short of it");
  assert.ok(!passed(0.1, 0.2, 0.224));
});
