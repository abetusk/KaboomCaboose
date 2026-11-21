// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Weather per level (src/client/climate.ts), rain and snow
// (src/client/weather.ts) and bird flocks (src/client/birds.ts).
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { join, dirname } from "node:path";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

// Resolve the bare name "three" as the page's import map does.
//
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "three") { return { url: "file://" + join(ROOT, "vendor/three/build/three.module.js"), shortCircuit: true }; }
    return next(spec, ctx);
  },
});

const { weatherOf, Climate } = await import("../src/client/climate.ts");
const { WeatherView }        = await import("../src/client/weather.ts");
const { Birds }              = await import("../src/client/birds.ts");
const { World }              = await import("../src/sim/world.ts");
const { Cell, Grid }         = await import("../src/level/cells.ts");

// A flat strip with stations at both ends and a row of trees.
//
function strip(w: number, h: number): InstanceType<typeof World> {
  const g = new Grid(w, h, Cell.GROUND);
  for (let x = 0; x < 3; x++) { g.set(x, 1, Cell.STATION); g.set(w - 1 - x, 1, Cell.STATION); }
  for (let x = 0; x < w; x++) { g.set(x, h - 1, Cell.TREE); }
  return new World(g);
}

test("each level's weather comes from the room's seed, near the chances set", () => {
  let rain = 0, snow = 0;
  for (let k = 0; k < 4000; k++) {
    const w = weatherOf(7, k, 0.3, 0.15);
    if (w === "rain") { rain++; } else if (w === "snow") { snow++; }
  }
  assert.ok(Math.abs((rain / 4000) - 0.3) < 0.03, "rain " + rain);
  assert.ok(Math.abs((snow / 4000) - 0.15) < 0.03, "snow " + snow);
  assert.equal(weatherOf(7, 3, 0.3, 0.15), weatherOf(7, 3, 0.3, 0.15));
  assert.equal(weatherOf(7, 3, 0, 0), "clear");
  const c = new Climate(1, [20], 1, 0, 0);
  assert.deepEqual([c.at(5, 1), c.at(30, 1), c.any], ["rain", "rain", true]);
});

test("rain falls over the window's part of the level, with puddles on plain ground; nothing with weather off", async () => {
  const w = strip(40, 8), cfg = { weather: true, rainDrops: 300, snowFlakes: 200, rainSplash: 1, puddles: 0.5,
                                   rainVoxels: 2, arRainVoxels: 1, rainStreak: 3, rainSlant: 0.5,
                                   rainSpeed: 9 },
        v = new WeatherView(cfg);
  v.setWorld(w, new Climate(1, [], 1, 0, 0), () => 0.5);
  const pools = (v as any).poolAt as number[];
  assert.ok( (pools.length > 60) && (pools.length < 200), pools.length + " puddles");
  assert.ok(pools.every(i => (w.type(i) === Cell.GROUND)));
  for (let k = 0; k < 120; k++) { v.update(1 / 60, -5, 12); }
  const drops = (v as any).drops as { x: number, y: number, on: boolean }[];
  assert.equal(drops.length, 300);
  assert.ok(drops.every(d => ( (d.x >= 0) && (d.x <= 12 + 0.5) && d.on )), "over the level inside the window, all rain");
  assert.equal(((v as any).flakes as unknown[]).length, 0, "no snow where none falls");
  assert.ok(((v as any).splashes as unknown[]).length > 0, "drops landed and splashed");

  // Drops are staircases of 3 cubes of 2 terrain voxels (1 in AR), every
  // cube on the grid of its size.
  //
  const rain = (v as any).rain, m = new (await import("three")).Matrix4(),
        cubes = (size: number) => {
          assert.equal(rain.count, 300 * 3);
          for (let k = 0; k < rain.count; k++) {
            rain.getMatrixAt(k, m);
            const e = m.elements, on = (e[0] > 0), grid = (u: number) => (Math.abs(((u / size) - 0.5) - Math.round((u / size) - 0.5)) < 1e-4);
            if (!on) { continue; }
            assert.ok(Math.abs(e[0] - size) < 1e-6, "cube " + e[0]);
            assert.ok( grid(e[12]) && grid(e[13]) && grid(e[14]), "on the grid " + [e[12], e[13], e[14]].join(","));
          }
        };
  cubes(2 / 32);
  v.update(1 / 60, -5, 12, true);
  cubes(1 / 32);
  cfg.weather = false;
  v.update(1 / 60, 0, 12);
  assert.equal(v.group.visible, false);
});

test("bird flocks come in, circle or land, and a perched flock flies off when something happens near it", () => {
  const w = strip(30, 8), b = new Birds({ birds: true, birdFlocks: 3, birdsPerFlock: 6 }),
        bw = { x0: 0, x1: 30, depth: 8, perch: (x: number, z: number) => ( w.inside(x, z) ? 0.5 : null ), near: () => false },
        flocks = () => (b as any).flocks as { mode: string, birds: { p: { x: number, y: number, z: number }, down: boolean }[] }[];
  const seen = new Set<string>();
  let perched: ReturnType<typeof flocks>[number] | undefined;
  for (let k = 0; ( (k < (60 * 240)) && !perched ); k++) {
    b.update(1 / 60, bw);
    for (const f of flocks()) {
      seen.add(f.mode);
      for (const p of f.birds) { assert.ok(Number.isFinite(p.p.x + p.p.y + p.p.z)); }
    }
    perched = flocks().find(f => ( (f.mode === "perched") && f.birds.every(q => q.down) ));
  }
  assert.ok(seen.has("cross") && seen.has("circle"), [...seen].join(","));
  assert.ok(perched, "a flock landed");
  assert.ok(perched!.birds.every(q => (Math.abs(q.p.y - 0.5) < 1e-6)), "standing on the ground");
  const at = perched!.birds[0].p;
  b.disturb(at.x, at.y, at.z);
  b.update(1 / 60, bw);
  assert.equal(perched!.mode, "flee");
  for (let k = 0; k < 60; k++) { b.update(1 / 60, bw); }
  assert.ok(perched!.birds.every(q => ( !q.down && (q.p.y > 1) )), "up and away");
});
