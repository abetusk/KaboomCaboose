// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Shared command-line display: map, legend, and statistics.
//

import { Cell, Grid, isRamp } from "../level/cells.ts";
import { render, legend, ARROW_UNI, ARROW_ASC, type AsciiOpts, type Overlay } from "../level/ascii.ts";
import type { Analysis } from "./analyze.ts";
import type { RouteStats, Route } from "./generate.ts";

export type Show = "path" | "path-height" | "routes" | "height" | "none";

export interface DisplayOpts extends AsciiOpts {
  show : Show;
}

export function parseDisplay(args: Map<string, string | true>): DisplayOpts {
  const show = String(args.get("show") ?? "path");
  if ( (show !== "path") && (show !== "path-height") && (show !== "routes") && (show !== "height") && (show !== "none") ) {
    throw new Error("--show must be path, path-height, routes, height or none");
  }
  return {
    color   : !args.has("no-color"),
    unicode : !args.has("ascii"),
    wide    : args.has("wide"),
    truecolor : args.has("truecolor"),
    show    : show as Show,
  };
}

// Overlay the cheapest path, or the generator's forced routes, on
// non-station cells.
//
function overlay(g: Grid, a: Analysis, routes: Route[] | null, o: DisplayOpts): [Overlay, [string, string][]] {
  const ov: Overlay = new Map(), marks: [string, string][] = [];
  const stationAt = (x: number, y: number) => a.stations.start.concat(a.stations.end).some(p => ( (p[0] === x) && (p[1] === y) ));

  if ( ( (o.show === "path") || (o.show === "path-height") ) && a.cheapest ) {
    const m  = ( o.unicode ? "•" : "*" ),
          br = "=";
    for (const p of a.cheapest.steps) {
      const i = (p.y * g.w) + p.x;
      if (p.kind === "station") { continue; }
      if      (p.kind === "ramp")         { ov.set(i, ( o.unicode ? ARROW_UNI : ARROW_ASC )[p.dir]); }
      else if (p.kind === "bridge")       { ov.set(i, br); }
      else if (o.show === "path-height")  { ov.set(i, String(p.z % 10)); }
      else                                { ov.set(i, m); }
    }
    marks.push([ ( (o.show === "path-height") ? "0-9" : m ),
                 ( (o.show === "path-height") ? "cheapest track, by height level" : "cheapest track" ) ]);
    marks.push([ ( o.unicode ? "↑" : "^" ), "ramp on the track, arrow uphill" ]);
    marks.push([ br, "bridge to build" ]);
  }
  else if (o.show === "height") {
    for (let i = 0; i < g.cells.length; i++) {
      ov.set(i, ( isRamp(g.cells[i]) ? ( o.unicode ? ARROW_UNI : ARROW_ASC )[g.dir[i]] : String(g.height[i] % 10) ));
    }
    marks.push(["0-9", "height level"]);
    marks.push([ ( o.unicode ? "↑" : "^" ), "ramp, arrow uphill" ]);
  }
  else if ( (o.show === "routes") && routes ) {
    for (const r of routes) {
      const m = r.name.toLowerCase();
      for (const [x, y] of r.cells) {
        const i = (y * g.w) + x;
        if (stationAt(x, y)) { continue; }
        if (isRamp(g.cells[i])) { ov.set(i, ( o.unicode ? ARROW_UNI : ARROW_ASC )[g.dir[i]]); continue; }
        ov.set(i, ( ov.has(i) ? "+" : m ));
      }
      marks.push([m, "route " + r.name]);
    }
    marks.push(["+", "both routes"]);
  }
  return [ov, marks];
}

// Share of all cells taken by each feature type.
//
function coverage(g: Grid): string {
  const n = g.cells.length,
        k = (c: number) => g.cells.reduce((s, v) => ( (v === c) ? (s + 1) : s ), 0),
        pct = (c: number) => ((100 * k(c)) / n).toFixed(1) + "%";
  let top = 0;
  for (let i = 0; i < n; i++) { top = Math.max(top, g.height[i]); }
  const lv = [] as string[];
  for (let z = 0; z <= top; z++) {
    const m = g.height.reduce((s, v) => ( (v === z) ? (s + 1) : s ), 0);
    lv.push("z" + z + " " + ((100 * m) / n).toFixed(0) + "%");
  }
  return "trees " + pct(Cell.TREE) + ", rock " + pct(Cell.ROCK) +
         ", black rock " + pct(Cell.BLACKROCK) + " (incl. walls), water " + pct(Cell.WATER) +
         ", ramps " + (k(Cell.RAMP_GROUND) + k(Cell.RAMP_BLACKROCK)) +
         "   heights: " + lv.join(", ");
}

export function report(g: Grid, a: Analysis, C: number, bridgeTrees: number, o: DisplayOpts,
                       routes: Route[] | null = null, rs: RouteStats[] | null = null): string {
  const [ov, marks] = overlay(g, a, routes, o),
        out = [] as string[];

  out.push(render(g, o, ov));
  out.push("");
  out.push(legend(o, marks));
  out.push("");
  out.push("size " + g.w + " x " + g.h + "   C = " + C + " track per tree+rock   bridge = " + bridgeTrees + " tree(s) per water cell");
  out.push("cover: " + coverage(g));
  out.push("reachable: trees T = " + a.reachTrees + ", rock R = " + a.reachRock);
  if (a.cheapest) {
    const have = a.cheapest.steps.filter(p => ( (p.kind === "ramp") && p.built )).length;
    out.push("cheapest path: " + a.trackNeeded + " track, " + a.cheapest.bridges + " bridge cells, " +
             a.cheapest.ramps + " ramps to build" + ( have ? (", " + have + " ramps already in the level") : "" ) +
             "   needs " + a.treesNeeded + " trees, " + a.rockNeeded + " rock" +
             "   ratio min(T,R)*C/track = " + a.ratio.toFixed(2) +
             "   " + ( a.feasible ? "feasible" : "NOT FEASIBLE" ));
  }
  else {
    out.push("cheapest path: none (start and end are not connected)");
  }
  if ( a.cheapest && a.cheapest.reusesColumn ) {
    out.push("WARNING: the cheapest track found uses a column twice, which cannot be built");
  }
  if (rs) {
    for (const s of rs) {
      out.push("route " + s.name + ": " + s.track + " track, choke gaps " + s.gaps.join("/") +
               ", resources nearby T = " + s.nearTrees + " R = " + s.nearRock +
               ", ratio " + s.ratio.toFixed(2) + ( s.feasible ? "" : " NOT FEASIBLE" ));
    }
  }
  return out.join("\n");
}

// Minimal --key value / --flag parser. Names in `flags` take no value.
//
const FLAGS = new Set(["no-color", "truecolor", "ascii", "wide", "quiet", "help", "path-ramps"]);

export function parseArgs(argv: string[]): [Map<string, string | true>, string[]] {
  const m = new Map<string, string | true>(), rest = [] as string[];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { rest.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > 0) { m.set(a.slice(2, eq), a.slice(eq + 1)); continue; }
    const name = a.slice(2);
    if (FLAGS.has(name)) { m.set(name, true); continue; }
    if (argv[i + 1] === undefined) { throw new Error("--" + name + " needs a value"); }
    m.set(name, argv[i + 1]);
    i++;
  }
  return [m, rest];
}
