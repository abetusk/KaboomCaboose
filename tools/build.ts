// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Build the browser client into web/ (D13.2): TypeScript under src/ is
// turned into JavaScript by removing its type annotations (Node's
// built-in stripTypeScriptTypes), relative ".ts" imports become ".js",
// and the page, libraries, assets and config are copied alongside. No
// dependencies, no bundling: the browser loads the modules as they are.
//
//   node tools/build.ts [OUTDIR]
//
// Any static web server can then serve OUTDIR (default web/).
//

import { readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { stripTypeScriptTypes } from "node:module";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

function files(dir: string): string[] {
  const out = [] as string[];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...files(p)); }
    else                           { out.push(p); }
  }
  return out;
}

// Rewrite relative module specifiers ending in .ts, in static imports,
// exports and dynamic imports, to .js.
//
export function rewriteImports(js: string): string {
  return js.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']+)\.ts\2/g, "$1$2$3.js$2");
}

export function build(out = join(ROOT, "web")): string {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  // Silence Node's one-line notice that stripTypeScriptTypes is
  // experimental; it would print on every build.
  //
  const warn = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    if (String(w).includes("stripTypeScriptTypes")) { return; }
    (warn as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;

  let n = 0;
  for (const f of files(join(ROOT, "src"))) {
    if (!f.endsWith(".ts")) { continue; }
    const js  = rewriteImports(stripTypeScriptTypes(readFileSync(f, "utf8"), { mode: "strip" })),
          dst = join(out, relative(ROOT, f)).replace(/\.ts$/, ".js");
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, js);
    n++;
  }
  process.emitWarning = warn;

  cpSync(join(ROOT, "client", "index.html"), join(out, "index.html"));
  for (const d of ["vendor/three", "config", "assets/generated", "assets/third_party"]) {
    cpSync(join(ROOT, d), join(out, d), { recursive: true });
  }
  return n + " modules -> " + relative(process.cwd(), out);
}

if (import.meta.url === ("file://" + process.argv[1])) {
  console.log(build(process.argv[2]));
}
