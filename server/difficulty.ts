// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Difficulty sets (config/difficulty.json): named changes to the shared
// settings sections, applied to a room's copy when it is made. Checked on
// load, so a typo fails loudly: every section must be a shared one and
// every key must exist there with a value of the same type.
//

import raw from "../config/difficulty.json" with { type: "json" };
import { CONFIG } from "../src/config.ts";
import { SHARED_SECTIONS } from "../src/net/protocol.ts";

type Sections = Record<string, Record<string, unknown>>;

function check(): { sets: Record<string, Sections>, def: string } {
  const r    = raw as unknown as { default: string, sets: Record<string, Sections> },
        bad  = (m: string) => { throw new Error("config/difficulty.json: " + m); },
        file = CONFIG as unknown as Sections;
  if ( !r.sets || (typeof r.sets !== "object") ) { bad("sets is missing"); }
  for (const [name, set] of Object.entries(r.sets)) {
    for (const [sec, vals] of Object.entries(set)) {
      if (!SHARED_SECTIONS.includes(sec)) { bad(name + ": " + sec + " is not a shared section"); }
      for (const [k, v] of Object.entries(vals)) {
        const old  = file[sec][k],
              same = ( Array.isArray(old) ?
                       ( Array.isArray(v) && (v.length === old.length) && v.every(e => (typeof e === typeof old[0])) ) :
                       ( (k in file[sec]) && (typeof v === typeof old) ) );
        if (!same) { bad(name + ": " + sec + "." + k + " is unknown or of the wrong type"); }
      }
    }
  }
  if (!(r.default in r.sets)) { bad("default " + r.default + " is not a set"); }
  return { sets: r.sets, def: r.default };
}

const D = check();

export const DIFFICULTIES       = Object.keys(D.sets),
             DEFAULT_DIFFICULTY = D.def;

// Apply a set's changes to a room's settings copy.
//
export function applyDifficulty(cfg: Sections, name: string): void {
  for (const [sec, vals] of Object.entries(D.sets[name] ?? {})) {
    for (const [k, v] of Object.entries(vals)) { cfg[sec][k] = structuredClone(v); }
  }
}
