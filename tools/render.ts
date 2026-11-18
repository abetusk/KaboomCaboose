// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Print a Tiled level file (for example after editing it in Tiled),
// with the same checks the generator runs.
//

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fromTmj } from "../src/level/tiled.ts";
import { analyze } from "../src/gen/analyze.ts";
import { parseArgs, parseDisplay, report } from "../src/gen/report.ts";
import { DEFAULTS } from "../src/gen/generate.ts";

const USAGE = `usage: node tools/render.ts [options] LEVEL.tmj

  --c N             track pieces per tree + rock (default ${DEFAULTS.C})
  --bridge-trees N  trees per water cell bridged (default ${DEFAULTS.bridgeTrees})
  --show WHAT       overlay: path, path-height, height or none (default path)
  --wide            two characters per cell
  --ascii           plain ASCII glyphs
  --no-color        no ANSI colour
  --truecolor       24-bit colour (default is the 256-colour palette)`;

function main(): void {
  const [args, files] = parseArgs(process.argv.slice(2));
  if ( args.has("help") || (files.length !== 1) ) { console.log(USAGE); return; }

  const file = files[0],
        map  = JSON.parse(readFileSync(file, "utf8")),
        src  = map.tilesets[0].source;
  const ts   = ( src ? JSON.parse(readFileSync(join(dirname(file), src), "utf8")) : map.tilesets[0] );

  const C           = Number(args.get("c") ?? DEFAULTS.C),
        bridgeTrees = Number(args.get("bridge-trees") ?? DEFAULTS.bridgeTrees),
        g           = fromTmj(map, ts),
        a           = analyze(g, { C, bridgeTrees }),
        o           = parseDisplay(args);

  console.log(report(g, a, C, bridgeTrees, o));
}

try { main(); }
catch (e) {
  console.error(String((e as Error).message ?? e));
  process.exit(1);
}
