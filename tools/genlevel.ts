// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Generate a level, print it, optionally write it as a Tiled map.
//

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { generate, DEFAULTS, type GenParams } from "../src/gen/generate.ts";
import { parseArgs, parseDisplay, report } from "../src/gen/report.ts";
import { toTmj, tilesetTsj, tilesetPng } from "../src/level/tiled.ts";
import { toJson } from "../src/level/json.ts";

const USAGE = `usage: node tools/genlevel.ts [options]

  --seed N          random seed (default: random, printed)
  --length N        cells from start to end (default ${DEFAULTS.length})
  --width N         cells across (default ${DEFAULTS.width})
  --chokes N        number of choke walls (default ${DEFAULTS.chokes})
  --narrow-gap A-B      route A's gap in each wall, in rows (default ${DEFAULTS.narrowGap.join("-")})
  --wide-gap A-B        route B's gap in each wall, in rows (default ${DEFAULTS.wideGap.join("-")})
  --wall-thickness A-B  choke wall thickness along x, in cells (default ${DEFAULTS.wallThickness.join("-")})
  --choke-sep N     hint for rows of black rock between the two gaps in a wall:
                    0 no preference, -1 as far apart as possible; best effort
                    (default ${DEFAULTS.chokeSeparation})
  --c N             track pieces per tree + rock (default ${DEFAULTS.C})
  --bridge-trees N  trees per water cell bridged (default ${DEFAULTS.bridgeTrees})
  --min-ratio X     reject levels whose resource ratio is below X (default ${DEFAULTS.minRatio})
  --trees D         forest seeds per 1000 cells (default ${DEFAULTS.forestDensity})
  --rock D          rock seeds per 1000 cells (default ${DEFAULTS.rockDensity})
  --blackrock D     black rock seeds per 1000 cells, besides choke walls (default ${DEFAULTS.blackrockDensity})
  --water D         pond seeds per 1000 cells (default ${DEFAULTS.pondDensity})
  --tree-size A-B       cells per forest (default ${DEFAULTS.forestSize.join("-")})
  --rock-size A-B       cells per rock patch (default ${DEFAULTS.rockSize.join("-")})
  --blackrock-size A-B  cells per black rock patch (default ${DEFAULTS.blackrockSize.join("-")})
  --water-size A-B      cells per pond (default ${DEFAULTS.pondSize.join("-")})
  --max-attempts N  give up after N rejected attempts (default ${DEFAULTS.maxAttempts})
  --levels N        height levels, 1 = flat (default ${DEFAULTS.levels})
  --hill-scale N    size of hills and valleys in cells (default ${DEFAULTS.hillScale})
  --hill-noise X    strength of the second noise octave, 0 = round blobs (default ${DEFAULTS.hillNoise})
  --min-blob N      smallest region of one level, in cells (default ${DEFAULTS.minBlob})
  --mountain-step N cells inward per extra level of black rock (default ${DEFAULTS.mountainStep})
  --mountain-max N  most levels black rock rises (default ${DEFAULTS.mountainMax})
  --ramp-chance X   chance per eligible boundary cell of a ready-made ramp (default ${DEFAULTS.rampChance})
  --path-ramps      build the ramps the cheapest track needs into the level
  --start-y N       start station row (default random)
  --end-y N         end station row (default random)
  --out FILE.tmj    write a Tiled map; cells.tsj and cells.png go next to it
  --json FILE.json  write the plain JSON level format
  --show WHAT       overlay: path (cheapest track), path-height (path cells as height
                    digits), routes, height, none (default path)
  --wide            two characters per cell
  --ascii           plain ASCII glyphs
  --no-color        no ANSI colour
  --truecolor       24-bit colour (default is the 256-colour palette)
  --quiet           print statistics only`;

function num(args: Map<string, string | true>, k: string, d: number): number {
  const v = args.get(k);
  if (v === undefined) { return d; }
  const n = Number(v);
  if ( (v === true) || !Number.isFinite(n) ) { throw new Error("--" + k + " needs a number"); }
  return n;
}

// "A-B" or a single number "A" (meaning A-A).
//
function range(args: Map<string, string | true>, k: string, d: [number, number]): [number, number] {
  const v = args.get(k);
  if (v === undefined) { return d; }
  const m = ( (typeof v === "string") ? /^(\d+)(?:-(\d+))?$/.exec(v) : null );
  if (!m) { throw new Error("--" + k + " needs A-B, for example 5-20"); }
  const lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
  if ( (lo < 1) || (hi < lo) ) { throw new Error("--" + k + ": need 1 <= A <= B"); }
  return [lo, hi];
}

function main(): void {
  const [args] = parseArgs(process.argv.slice(2));
  if (args.has("help")) { console.log(USAGE); return; }

  const p: GenParams = {
    ...DEFAULTS,
    seed        : num(args, "seed", Math.floor(Math.random() * 1e9)),
    length      : num(args, "length", DEFAULTS.length),
    width       : num(args, "width", DEFAULTS.width),
    chokes      : num(args, "chokes", DEFAULTS.chokes),
    C           : num(args, "c", DEFAULTS.C),
    bridgeTrees : num(args, "bridge-trees", DEFAULTS.bridgeTrees),
    minRatio    : num(args, "min-ratio", DEFAULTS.minRatio),
    maxAttempts : num(args, "max-attempts", DEFAULTS.maxAttempts),
    forestDensity    : num(args, "trees", DEFAULTS.forestDensity),
    rockDensity      : num(args, "rock", DEFAULTS.rockDensity),
    blackrockDensity : num(args, "blackrock", DEFAULTS.blackrockDensity),
    pondDensity      : num(args, "water", DEFAULTS.pondDensity),

    forestSize    : range(args, "tree-size", DEFAULTS.forestSize),
    rockSize      : range(args, "rock-size", DEFAULTS.rockSize),
    blackrockSize : range(args, "blackrock-size", DEFAULTS.blackrockSize),
    pondSize      : range(args, "water-size", DEFAULTS.pondSize),
    narrowGap     : range(args, "narrow-gap", DEFAULTS.narrowGap),
    wideGap       : range(args, "wide-gap", DEFAULTS.wideGap),
    wallThickness : range(args, "wall-thickness", DEFAULTS.wallThickness),
    chokeSeparation : num(args, "choke-sep", DEFAULTS.chokeSeparation),

    levels     : num(args, "levels", DEFAULTS.levels),
    hillScale  : num(args, "hill-scale", DEFAULTS.hillScale),
    hillNoise  : num(args, "hill-noise", DEFAULTS.hillNoise),
    minBlob    : num(args, "min-blob", DEFAULTS.minBlob),
    mountainStep : num(args, "mountain-step", DEFAULTS.mountainStep),
    mountainMax  : num(args, "mountain-max", DEFAULTS.mountainMax),
    rampChance   : num(args, "ramp-chance", DEFAULTS.rampChance),
    pathRamps    : args.has("path-ramps"),

    startY      : ( args.has("start-y") ? num(args, "start-y", 0) : null ),
    endY        : ( args.has("end-y")   ? num(args, "end-y", 0)   : null ),
  };

  const lv = generate(p),
        o  = parseDisplay(args),
        sy = lv.analysis.stations.start[0][1],
        ey = lv.analysis.stations.end[0][1];

  console.log("seed " + p.seed + " (accepted attempt " + lv.attempt + ")   start row " + sy + ", end row " + ey);
  if (args.has("quiet")) {
    const a = lv.analysis;
    console.log("T = " + a.reachTrees + " R = " + a.reachRock + " track = " + a.trackNeeded + " ratio = " + a.ratio.toFixed(2));
  }
  else {
    console.log(report(lv.grid, lv.analysis, p.C, p.bridgeTrees, o, lv.routes, lv.routeStats));
  }

  const js = args.get("json");
  if (typeof js === "string") {
    mkdirSync(dirname(js), { recursive: true });
    const a = lv.analysis;
    writeFileSync(js, JSON.stringify(toJson(lv.grid, {
      seed     : p.seed,
      params   : p,
      stations : a.stations,
      routes   : lv.routes.map(r => ({ name: r.name, gaps: r.gaps, cells: r.cells })),
      track    : a.cheapest ? a.cheapest.steps : null,
      stats    : {
        reachTrees  : a.reachTrees,
        reachRock   : a.reachRock,
        trackNeeded : a.trackNeeded,
        bridges     : a.cheapest ? a.cheapest.bridges : null,
        ramps       : a.cheapest ? a.cheapest.ramps : null,
        treesNeeded : a.treesNeeded,
        rockNeeded  : a.rockNeeded,
        ratio       : a.ratio,
      },
    })) + "\n");
    console.log("wrote " + js);
  }

  const out = args.get("out");
  if (typeof out === "string") {
    const dir = dirname(out);
    mkdirSync(dir, { recursive: true });
    const props = [
      { name: "seed",        type: "int",    value: p.seed },
      { name: "generator",   type: "string", value: JSON.stringify(p) },
      { name: "start_y",     type: "int",    value: sy },
      { name: "end_y",       type: "int",    value: ey },
    ];
    writeFileSync(out, JSON.stringify(toTmj(lv.grid, props, "cells.tsj"), null, 1) + "\n");
    if (!existsSync(join(dir, "cells.tsj"))) {
      writeFileSync(join(dir, "cells.tsj"), JSON.stringify(tilesetTsj("cells.png"), null, 1) + "\n");
    }
    if (!existsSync(join(dir, "cells.png"))) {
      writeFileSync(join(dir, "cells.png"), tilesetPng());
    }
    console.log("wrote " + out);
  }
}

try { main(); }
catch (e) {
  console.error(String((e as Error).message ?? e));
  process.exit(1);
}
