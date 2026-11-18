// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Station upgrades (D6.7), read from config/upgrades.json and checked on
// load: every change must name a number setting of a section the game
// runs on (rules, train, avatar, station), and a wagon must be a kind the
// train can carry (WAGON_ITEMS).
//

import raw from "../config/upgrades.json" with { type: "json" };
import { CONFIG } from "./config.ts";
import { WAGON_ITEMS } from "./sim/world.ts";

export interface Upgrade {
  kind    : string;
  label   : string;
  unit    : string;
  max     : number;
  changes : [string, string, number][];

  // A wagon to carry to the back of the train instead of (or as well as)
  // setting changes; "" none.
  //
  wagon   : string;

  // Offered only once this upgrade has been taken in the run; "" always.
  //
  needs   : string;
}

const SECTIONS = ["rules", "train", "avatar", "station"];

function load(): { list: Upgrade[], per: number } {
  const r    = raw as unknown as { perStation: number, upgrades: Record<string, { label: string, unit?: string, max: number, changes?: Record<string, number>, wagon?: string, needs?: string }> },
        bad  = (m: string) => { throw new Error("config/upgrades.json: " + m); },
        file = CONFIG as unknown as Record<string, Record<string, unknown>>;
  if ( !Number.isInteger(r.perStation) || (r.perStation < 1) ) { bad("perStation must be an integer >= 1"); }
  const list = Object.entries(r.upgrades ?? {}).map(([kind, u]) => {
    if ( (typeof u.label !== "string") || !Number.isInteger(u.max) || (u.max < 1) ) { bad(kind + ": needs a label and an integer max >= 1"); }
    const changes = Object.entries(u.changes ?? {}).map(([path, d]) => {
      const [sec, key] = path.split(".");
      if ( !SECTIONS.includes(sec) || (typeof file[sec]?.[key] !== "number") || !Number.isFinite(d) ) {
        bad(kind + ": " + path + " is not a number setting of " + SECTIONS.join(", "));
      }
      return [sec, key, d] as [string, string, number];
    });
    const wagon = u.wagon ?? "";
    if ( wagon && !(wagon in WAGON_ITEMS) ) { bad(kind + ": wagon must be one of " + Object.keys(WAGON_ITEMS).join(", ")); }
    if ( !changes.length && !wagon ) { bad(kind + ": no changes and no wagon"); }
    return { kind, label: u.label, unit: (u.unit ?? ""), max: u.max, changes, wagon, needs: (u.needs ?? "") };
  });
  if (!list.length) { bad("no upgrades"); }
  for (const u of list) {
    if ( u.needs && !list.some(v => (v.kind === u.needs)) ) { bad(u.kind + ": needs " + u.needs + ", which is not an upgrade"); }
  }
  return { list, per: r.perStation };
}

const U = load();

export const UPGRADES: Upgrade[] = U.list,
             OFFERS_PER_STATION   = U.per;

export function upgrade(kind: string): Upgrade | undefined { return UPGRADES.find(u => (u.kind === kind)); }
