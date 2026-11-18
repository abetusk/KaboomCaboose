// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Development shortcuts (server --dev, 2026-11-16): reach a situation in
// seconds instead of playing up to it. Each command acts on the room's
// game for the player who sent it and returns a line saying what it did
// (or why it could not). Without --dev the server ignores them.
//
//   arrive         lay track straight along the station row to the end
//                  station if the line does not reach it yet, and arrive
//                  there (the station's upgrades are offered)
//   offer:KIND     arrive if needed, and offer upgrade KIND first
//   give:WHAT      put WHAT in the player's hands: wood, ore, track (a
//                  full load), stick, lit (a lit stick), or a wagon:
//                  storage, crafting, dynamite
//   wagon:KIND     add wagon KIND at the back of the train
//   fill           fill the wagons: wood, ore, track, sticks
//   skip:N         arrive and go on until level N is being played
//   crash          derail the train now
//   stand:N        move the player into offer N's circle (0 first), as
//                  if they walked there; it is taken after the dwell
//   take:KIND      take upgrade KIND now, as if picked at a station
//                  (without moving on), to see what it looks like
//

import { Game, MAX_CARS, Tool } from "../src/sim/game.ts";
import { Item, WAGON_ITEMS, type ItemKind } from "../src/sim/world.ts";
import { upgrade } from "../src/upgrades.ts";

export const DEV_COMMANDS = ["arrive", "offer:KIND", "give:WHAT", "wagon:KIND", "fill", "skip:N", "crash", "stand:N", "take:KIND"];

// Lay track from the line's open end east along the end station's row
// until the line reaches the end station; then put the train's front at
// the station's east end, arrived.
//
function arrive(g: Game): string {
  if (g.phase === "arrived") { return "already arrived"; }
  const w = g.w, [ex, ey] = w.end[w.end.length - 1], last = w.idx(ex, ey);
  for (let k = 0; ( (k < w.w) && !g.line.includes(last) ); k++) {
    const [x, y] = w.xy(g.lineEnd());
    if ( (y !== ey) || !w.inside(x + 1, y) || !w.layTrack(w.idx(x + 1, y), g.lineEnd()) ) {
      return "cannot lay straight track to the end station from " + x + "," + y;
    }
    g.line = w.line();
  }
  if (g.startT < 0) { g.begin(); }
  g.train.p = g.line.indexOf(last) + 0.5;
  g.train.v = 0;
  g.phase   = "arrived";
  g.events.push("arrived");
  if (!g.lastLevel()) { g.offer(); }
  g.shapeTrain();
  return "arrived at level " + (w.seg + 1) + "'s end station";
}

export function devCommand(g: Game, id: number, cmd: string): string {
  const p = g.players.get(id), [verb, arg = ""] = cmd.split(":"), r = g.s.rules, t = g.train;
  if (verb === "arrive") { return arrive(g); }
  if (verb === "offer") {
    if (!upgrade(arg)) { return "no upgrade " + arg; }
    if (g.phase !== "arrived") { arrive(g); }
    if (g.lastLevel()) { return "no offers at the last station"; }
    if (!g.offers.length) { g.offer(); }
    if (!g.offers.length) { return "no room beside the station for offers"; }
    g.picked = "";
    g.offers[0].kind = arg;
    g.offers = g.offers.filter((o, k) => ( (k === 0) || (o.kind !== arg) ));
    return "offering " + arg;
  }
  if (verb === "give") {
    if (!p) { return "no player"; }
    const kinds: Record<string, [ItemKind, number]> = {
      wood: [Item.WOOD, r.carryMax], ore: [Item.ORE, r.carryMax], track: [Item.TRACK, r.carryMax],
      stick: [Item.DYNAMITE, 1], lit: [Item.DYNAMITE, 1],
      ...Object.fromEntries(Object.entries(WAGON_ITEMS).map(([k, it]) => [k, [it, 1] as [ItemKind, number]])),
    };
    const k = kinds[arg];
    if (!k) { return "give what? " + Object.keys(kinds).join(", "); }
    g.setTool(p, Tool.NONE);
    p.carry = k[0]; p.count = k[1];
    p.fuse  = ( (arg === "lit") ? r.fuseSeconds : -1 );
    p.aimT  = -1;
    return "gave " + arg;
  }
  if (verb === "wagon") {
    if (!(arg in WAGON_ITEMS)) { return "wagon kinds: " + Object.keys(WAGON_ITEMS).join(", "); }
    if (t.cars.length >= MAX_CARS) { return "the train is full"; }
    t.cars = [...t.cars, arg];
    g.shapeTrain();
    return "added a " + arg + " wagon";
  }
  if (verb === "fill") {
    t.wood = g.storageCap(); t.ore = g.storageCap(); t.track = g.trackCap();
    if (t.cars.includes("dynamite")) { t.sticks = r.dynamiteMax; }
    return "wagons filled";
  }
  if (verb === "skip") {
    const n = Math.max(1, Math.min(g.w.segments, Math.round(Number(arg))));
    if (!Number.isFinite(n)) { return "skip to which level?"; }
    while ((g.w.seg + 1) < n) {
      const why = arrive(g);
      if (g.phase !== "arrived") { return why; }
      g.nextSegment();
    }
    return "playing level " + (g.w.seg + 1);
  }
  if (verb === "stand") {
    const o = g.offers[Math.max(0, Math.round(Number(arg) || 0))];
    if ( !p || !o ) { return "no such offer"; }
    p.x = o.x; p.y = o.y;
    return "standing in the " + o.kind + " circle";
  }
  if (verb === "take") {
    if (!upgrade(arg)) { return "no upgrade " + arg; }
    const was = g.picked;
    g.take(arg, p ?? null);
    g.picked = was;
    return "took " + arg + " (" + g.taken[arg] + " taken)";
  }
  if (verb === "crash") {
    g.phase = "derailed";
    g.events.push("derailed");
    return "derailed";
  }
  return "commands: " + DEV_COMMANDS.join(", ");
}
