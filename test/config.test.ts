// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.ts";
import { DEFAULTS } from "../src/gen/generate.ts";

// Loading the config already checks every key against its _doc; here
// check the values the rules depend on are sensible and shared values
// reach the generator.
//
test("config values are positive and shared with the generator", () => {
  for (const [k, v] of Object.entries(CONFIG.rules)) { assert.ok((v > 0), "rules." + k); }
  for (const [k, v] of Object.entries(CONFIG.train))   { assert.ok((v > 0), "train." + k); }
  for (const [k, v] of Object.entries(CONFIG.avatar))  { assert.ok((v > 0), "avatar." + k); }
  for (const [k, v] of Object.entries(CONFIG.station)) { assert.ok((v > 0), "station." + k); }
  assert.ok(Number.isInteger(CONFIG.rules.carryMax));
  assert.ok(Number.isInteger(CONFIG.rules.hitsPerBlock));
  assert.equal(DEFAULTS.C, CONFIG.rules.C);
  assert.equal(DEFAULTS.bridgeTrees, CONFIG.rules.bridgeTrees);
  assert.equal(DEFAULTS.length, CONFIG.levelgen.length);
});
