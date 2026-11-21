// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Client test, headless: build the terrain meshes for a generated level
// with the vendored three.js (no browser, no WebGL), and check the
// built modules parse.
//

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

// Resolve the bare name "three" as the page's import map does.
//
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "three") { return { url: "file://" + join(ROOT, "vendor/three/build/three.module.js"), shortCircuit: true }; }
    return next(spec, ctx);
  },
});

const { parseVox, voxGeometry, voxGet, VOXEL } = await import("../src/client/voxel.ts");
const mod          = await import("../src/client/terrain.ts");
const { Terrain }  = mod;
const { World }    = await import("../src/sim/world.ts");
const { Cell }     = await import("../src/level/cells.ts");
const { Game }     = await import("../src/sim/game.ts");
const { CONFIG }   = await import("../src/config.ts");
const { generate, DEFAULTS } = await import("../src/gen/generate.ts");

// The level the terrain tests build: seed 11 at a fixed length, so the
// checks do not move when config/game.json's levelgen is tuned.
//
const LEVEL = { ...DEFAULTS, length: 100, seed: 11 };

const vox = (f: string) => { const b = readFileSync(join(ROOT, f)); return parseVox(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const G = "assets/generated/", K = "assets/third_party/kytric/";

function models(): any {
  const r4 = (f: (k: number) => string) => [0, 1, 2, 3].map(k => vox(f(k)));
  return {
    ground: r4(k => G + "ground-" + k + ".vox"), forest: r4(k => G + "forest-floor-" + k + ".vox"),
    black: r4(k => G + "black-rock-" + k + ".vox"), water: r4(k => G + "water-" + (k % 2) + ".vox"),
    rock: [0, 1, 2, 3].map(v => r4(s => G + "grey-rock-" + v + "-s" + s + ".vox")),
    ramp: r4(k => G + "ramp-" + k + ".vox"), bridge: r4(k => G + "bridge-" + k + ".vox"),
    trees: [1, 2, 3, 4, 5, 6, 7, 8].map(k => vox(K + "tree-" + k + ".vox")),
    stump: vox(G + "stump-0.vox"), straight: vox(G + "track-straight-0.vox"), curve: vox(G + "track-curve-0.vox"),
    slope: vox(G + "track-ramp-0.vox"), wood: [vox(G + "item-wood-0.vox")], ore: [vox(G + "item-ore-0.vox")],
    grass: [0, 1, 2].map(k => vox(G + "grass-" + k + ".vox")),
    groundDetail: r4(k => G + "ground-detail-" + k + ".vox"), blackStrata: r4(k => G + "black-strata-" + k + ".vox"),
    boulders: [0, 1, 2].map(s => [0, 1, 2, 3].map(k => vox(G + "boulder-" + k + "-s" + s + ".vox"))),
    crags: [0, 1, 2, 3, 4, 5].map(k => vox(G + "crag-" + k + ".vox")),
    pebbles: [0, 1, 2].map(k => vox(G + "pebbles-" + k + ".vox")), flowers: [0, 1, 2].map(k => vox(G + "flowers-" + k + ".vox")),
    leaves: [0, 1, 2].map(k => vox(G + "leaves-" + k + ".vox")), gravel: [0, 1, 2].map(k => vox(G + "gravel-" + k + ".vox")),
    bush: [0, 1, 2].map(k => vox(G + "bush-" + k + ".vox")),
    vine: [0, 1, 2].map(k => vox(G + "vine-" + k + ".vox")), sideStone: [0, 1, 2].map(k => vox(G + "side-stone-" + k + ".vox")),
    grassFringe: [0, 1, 2].map(k => vox(G + "grass-fringe-" + k + ".vox")),
    carved: JSON.parse(readFileSync(join(ROOT, G + "carved-blocks.json"), "utf8")).blocks,
    carvedRelief: [0, 1, 2, 3, 4, 5, 6, 7].map(k => vox(G + "carved-relief-" + k + ".vox")),
    bricks: JSON.parse(readFileSync(join(ROOT, G + "rock-bricks.json"), "utf8")).tile,
    rockTiles: JSON.parse(readFileSync(join(ROOT, G + "rock-bricks.json"), "utf8")).tiles,
    rockCarve: JSON.parse(readFileSync(join(ROOT, G + "rock-relief.json"), "utf8")),
  };
}

test("ground stacks draw every item, however tall (D6a.14)", () => {
  const m = models(), lv = generate(LEVEL), w = new World(lv.grid);
  let at = -1;
  for (let i = 0; i < (w.w * w.h); i++) {
    if ( (w.type(i) === Cell.GROUND) && !w.track[i] && !w.stack[i] ) { at = i; break; }
  }
  w.stack[at] = 1; w.count[at] = 60;
  const t = new Terrain(w, m);
  t.update();
  let n = 0;
  t.props.traverse((o: any) => { if ( o.isInstancedMesh && (o.userData.vox === m.wood[0]) ) { n += o.count; } });
  assert.equal(n, 60);
});

test("terrain meshes build for a generated level and update after changes", () => {
  const m = models();
  const lv = generate(LEVEL), w = new World(lv.grid), t = new Terrain(w, m);
  t.update();
  assert.equal(t.chunks.length, Math.ceil(w.w / 8));
  let tris = 0;
  for (const c of [...t.chunks, ...t.dchunks]) { tris += c.geometry.index!.count / 3; }
  assert.ok( (tris > (w.w * w.h * 2)) && (tris < (w.w * w.h * 40)), "terrain triangles: " + tris );
  assert.ok(t.props.children.length > 3, "props drawn");

  // Lay a piece of track and chop a block through the game, then
  // rebuild: no errors, and the track shows up as a prop.
  //
  const g = new Game(w, { rules: CONFIG.rules, train: CONFIG.train, avatar: CONFIG.avatar, station: CONFIG.station, tickHz: 20 });
  const [ex, ey] = w.start[w.start.length - 1];
  w.g.cells[w.idx(ex + 1, ey)] = Cell.GROUND;
  w.layTrack(w.idx(ex + 1, ey), g.lineEnd());
  for (const i of w.changed) { t.touch(i); }
  t.update();
  assert.ok(w.track[w.idx(ex + 1, ey)]);
});

test("visual extras: every view toggle builds, and each adds what it should (D11.11)", () => {
  const { TERRAIN_VIEW_KEYS } = mod;
  const V = CONFIG.view as unknown as Record<string, unknown>, saved = { ...V };
  const flags = ["ao", "groundDetail", "groundPatches", "groundDecor", "treeVariety", "treeSway", "rockBoulders", "crags", "blackStrata",
                 "designedTiles", "edgeLines", "faceDecor", "carvedBlack", "carvedRelief", "brickRock", "brickRelief"];
  for (const f of flags) { assert.ok(TERRAIN_VIEW_KEYS.has(f), f + " rebuilds the terrain"); }
  const lv = generate(LEVEL), w = new World(lv.grid);
  const build = (on: boolean) => {
    for (const f of flags) { V[f] = on; }
    const t = new Terrain(w, models());
    t.update();
    const props = new Map<string, number>();
    let tris = 0;
    t.props.traverse((o: any) => {
      if (!o.isInstancedMesh) { return; }
      tris += (o.geometry.index.count / 3) * o.count;
      props.set(o.geometry.uuid, o.count);
    });
    return { t, tris, kinds: props.size };
  };
  try {
    const off = build(false), on = build(true);
    assert.ok(on.kinds > off.kinds, "more prop kinds with extras on: " + off.kinds + " -> " + on.kinds);
    console.log("prop triangles, extras off " + off.tris + ", on " + on.tris);

    // Corner shading: some top vertex is darker with ao than without.
    //
    const col = (t: any) => { let lo = Infinity; for (const c of [...t.chunks, ...t.dchunks]) { const a = c.geometry.getAttribute("color"); for (let k = 0; k < a.count; k++) { lo = Math.min(lo, a.getX(k)); } } return lo; };
    V.ao = false; V.groundPatches = false;
    const flat = new Terrain(w, models()); flat.update();
    V.ao = true;
    const shaded = new Terrain(w, models()); shaded.update();
    assert.ok(col(shaded) < (col(flat) - 0.05), "ao darkens corners");
  }
  finally { Object.assign(V, saved); }
});

test("ground tints: ground cells get several mild tints (D11.15)", () => {
  const { GROUND_TINTS, TREE_TINTS, BLACK_TINTS, TERRAIN_VIEW_KEYS } = mod;
  const V = CONFIG.view as unknown as Record<string, unknown>, saved = { ...V };
  for (const [k, list, most] of [["groundTints", GROUND_TINTS, 0.08], ["treeTints", TREE_TINTS, 0.1], ["blackTints", BLACK_TINTS, 0.08]] as [string, number[][], number][]) {
    assert.ok(TERRAIN_VIEW_KEYS.has(k));
    assert.equal(list.length, 16);
    assert.ok(list.every(t => t.every(c => (Math.abs(c - 1) <= most))), k + " are mild");
  }
  const lv = generate(LEVEL), w = new World(lv.grid);

  // Tints alone: the level palettes (view.palette) colour cells too.
  //
  V.palette = false;
  const colours = (on: boolean) => {
    V.groundTints = on; V.blackTints = on; V.ao = false; V.groundPatches = false; V.groundTintCount = 12; V.groundTintStrength = 1;
    const t = new Terrain(w, models());
    t.update();
    const seen = new Set<string>();
    for (const c of [...t.chunks, ...t.dchunks]) {
      const a = c.geometry.getAttribute("color");
      for (let k = 0; k < a.count; k++) { seen.add([a.getX(k), a.getY(k), a.getZ(k)].map(x => x.toFixed(4)).join()); }
    }
    return seen.size;
  };
  try {
    const off = colours(false), on = colours(true);
    assert.ok(on > off, "tints add colours: " + off + " -> " + on);

    // Trees: tinted instances carry colours, several different ones.
    //
    const treeCols = (on: boolean) => {
      V.treeTints = on; V.treeVariety = false; V.blackTints = false; V.rockTints = false;
      const t = new Terrain(w, models());
      t.update();
      const seen = new Set<string>();
      t.props.traverse((o: any) => {
        if ( !o.isInstancedMesh || !o.instanceColor ) { return; }
        for (let k = 0; k < o.count; k++) { seen.add(Array.from(o.instanceColor.array.slice(3 * k, (3 * k) + 3) as number[]).map(x => x.toFixed(3)).join()); }
      });
      return seen.size;
    };
    assert.ok(treeCols(true) >= 8, "trees get several tints");
    assert.equal(treeCols(false), 0, "no tree tints when off");
  }
  finally { Object.assign(V, saved); }
});

test("designed tiles: a lit rim only on the edges in the mask, and every face has its own spot (D11.12)", async () => {
  const { tileSheet, MATS, VARIANTS, TILE } = await import("../src/client/tiles.ts");
  const sh = tileSheet(), seen = new Set<string>();
  const px = (u: number, v: number) => { const i = 4 * ((Math.floor(v * sh.h) * sh.w) + Math.floor(u * sh.w)); return [sh.data[i], sh.data[i + 1], sh.data[i + 2]].join(); };
  for (const m of MATS) {
    for (let v = 0; v < VARIANTS; v++) {
      for (let mask = 0; mask < 16; mask++) { seen.add(sh.top(m, v, mask).join()); }
      seen.add(sh.side(m, v, true).join()); seen.add(sh.side(m, v, false).join());
    }
  }
  assert.equal(seen.size, MATS.length * VARIANTS * 18);

  // Ground variant 0: the north edge row (sampled mid-row) is the rim
  // colour with mask 1 and differs from it with mask 4 (south only).
  //
  const n1 = sh.top("ground", 0, 1), n4 = sh.top("ground", 0, 4), half = 0.5 / sh.h;
  const midU = (r: number[]) => ((r[0] + r[2]) / 2);
  assert.notEqual(px(midU(n1), n1[1] + half), px(midU(n4), n4[1] + half));
  assert.equal(px(midU(n4), n4[3] - half), px(midU(n1), n1[1] + half), "south rim with mask 4 matches north rim with mask 1");
  assert.equal(sh.w % TILE, 0);
});

test("carved black rock: classes come from the sheet, relief heights follow the classes (D11.13)", async () => {
  const { tileSheet } = await import("../src/client/tiles.ts");
  const { CARVED_TOPS } = await import("../src/assets/carved.ts");
  const { carvedClass } = await import("../src/assets/terrain.ts");
  const made = JSON.parse(readFileSync(join(ROOT, G + "carved-relief.json"), "utf8")),
        f: number = made.factor, hs: number[] = made.heights;
  const blocks: string[] = JSON.parse(readFileSync(join(ROOT, G + "carved-blocks.json"), "utf8")).blocks;
  assert.equal(blocks.length, 16);
  assert.ok(blocks.every(b => /^[0-4]{256}$/.test(b)));
  const plain = tileSheet(null), cut = tileSheet(blocks);
  assert.notDeepEqual(plain.data, cut.data, "carving changes the sheet");
  CARVED_TOPS.forEach(([r, c], v) => {
    const rel = vox(G + "carved-relief-" + v + ".vox"), b = [...blocks[(4 * r) + c]].map(Number);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        let top = 0;
        while (voxGet(rel, x, y, top)) { top++; }
        const k = carvedClass(b, 32 / f, Math.floor(x / f), Math.floor(y / f));
        assert.equal(top, hs[k], "relief " + v + " at " + x + "," + y);
        if (f === 2) { assert.equal(k, b[((y >> 1) * 16) + (x >> 1)], "factor 2 keeps the sheet's pixels"); }
      }
    }
  });
});

test("brick grey rock: the tile comes from the sheet; stages crack it; no rim (D11.14)", async () => {
  const { tileSheet } = await import("../src/client/tiles.ts");
  const tile: string = JSON.parse(readFileSync(join(ROOT, G + "rock-bricks.json"), "utf8")).tile;
  assert.match(tile, /^[0-2]{256}$/);
  assert.ok([0, 1, 2].every(k => tile.includes(String(k))), "joints, faces and lit edges all present");
  const plain = tileSheet(null, null), brick = tileSheet(null, tile);
  assert.notDeepEqual(plain.data, brick.data, "bricks change the sheet");
  const at = (r: number[]) => {
    const out = [] as number[];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const i = 4 * (((Math.round(r[1] * brick.h) + y) * brick.w) + Math.round(r[0] * brick.w) + x);
        out.push(brick.data[i], brick.data[i + 1], brick.data[i + 2]);
      }
    }
    return out;
  };
  assert.deepEqual(at(brick.top("rock0", 0, 0)), at(brick.top("rock0", 0, 15)), "no rim on brick tops");
  assert.notDeepEqual(at(brick.top("rock0", 0, 0)), at(brick.top("rock3", 0, 0)), "mining stages crack the stone");

  // Carving: every unit's tile comes from the sheet. Away from the
  // sides, each top column stands D - heights[class] below the block
  // top; away from the top and the corners, each exposed side column is
  // cut that deep; an unexposed side stays flat and solid.
  //
  const { brickClasses, brickSideClasses, brickBlock, BRICK_UNITS, BRICK_CRACK_CLASS } = await import("../src/assets/bricks.ts");
  const tiles: string[] = JSON.parse(readFileSync(join(ROOT, G + "rock-bricks.json"), "utf8")).tiles;
  assert.equal(tiles.length, BRICK_UNITS.length);
  assert.equal(new Set(tiles).size, tiles.length, "units differ");
  const o = JSON.parse(readFileSync(join(ROOT, G + "rock-relief.json"), "utf8")), hs: number[] = o.heights, b: number = o.border,
        D = Math.max(...hs), cell = (blk: Uint8Array, x: number, y: number, z: number) => blk[x + (32 * (y + (32 * z)))];
  for (const [u, s, v] of [[0, 0, 0], [3, 1, 2], [7, 3, 3]]) {
    const k = brickClasses(tiles[u], s, v), blk = brickBlock(tiles[u], s, v, 2, o), east = brickSideClasses(tiles[u], s, 8 + (4 * v) + 1);
    for (let y = D; y < (32 - D); y++) {
      for (let x = D; x < (32 - D); x++) {
        let z = 15;
        while ( (z >= 0) && !cell(blk, x, y, z) ) { z--; }
        const ring = ( (x < b) || (y < b) || (x >= (32 - b)) || (y >= (32 - b)) );
        assert.equal(15 - z, D - hs[( ring ? 0 : k[(y * 32) + x] )], "top u" + u + " s" + s + " v" + v + " at " + x + "," + y);
      }
    }
    for (let row = D; row < 16; row++) {
      for (let y = D + b; y < (32 - D - b); y++) {
        let cut = 0;
        while (!cell(blk, 31 - cut, y, 15 - row)) { cut++; }
        assert.equal(cut, D - hs[east[(row * 32) + (31 - y)]], "east side u" + u + " at " + y + "," + row);
        assert.ok(cell(blk, 0, y, 15 - row), "west side (not exposed) stays solid");
      }
    }
  }

  // Mining: a stage keeps the cracks of the stages before it and adds
  // more.
  //
  const cracks = (s: number) => brickClasses(tiles[0], s, 1).reduce((n, c) => ( n + ( (c === BRICK_CRACK_CLASS) ? 1 : 0 ) ), 0);
  for (let s = 1; s < 4; s++) {
    const a = brickClasses(tiles[0], s - 1, 1), c = brickClasses(tiles[0], s, 1);
    assert.ok(a.every((cl, j) => ( (cl !== BRICK_CRACK_CLASS) || (c[j] === BRICK_CRACK_CLASS) )), "stage " + s + " keeps earlier cracks");
    assert.ok(cracks(s) > cracks(s - 1), "stage " + s + " adds cracks");
  }
});

test("grey rock relief: units by region, a carved block per cell, stage follows hits (D11.14)", () => {
  const V = CONFIG.view as unknown as Record<string, unknown>, saved = { ...V };
  try {
    Object.assign(V, { designedTiles: true, brickRock: true, brickRelief: true, rockBoulders: false, rockPatterns: 8, rockPatternScale: 3, rockTints: true });
    const lv = generate(LEVEL), w = new World(lv.grid), m = models(), t = new Terrain(w, m);
    const rocks = [] as number[];
    for (let i = 0; i < (w.w * w.h); i++) { if (w.type(i) === Cell.ROCK) { rocks.push(i); } }
    assert.ok(rocks.length > 20);
    const units = rocks.map(i => t.rockUnit(i));
    assert.ok(new Set(units).size >= 3, "several patterns in use");
    let same = 0, pairs = 0;
    for (const i of rocks) {
      const j = w.step(i, 1);
      if ( (j >= 0) && (w.type(j) === Cell.ROCK) ) { pairs++; if (t.rockUnit(i) === t.rockUnit(j)) { same++; } }
    }
    assert.ok(same > (pairs / 2), "neighbours mostly share a pattern: " + same + " of " + pairs);
    V.rockPatternScale = 0;
    assert.ok(new Set(rocks.map(i => t.rockUnit(i))).size >= 6, "per cell at random with scale 0");
    V.rockPatternScale = 3;

    // One carved block per rock cell, merged per chunk; no textured box
    // under it. A hit carves the cell's next stage.
    //
    t.update();
    const rockMeshes = () => { const out = [] as any[]; t.props.traverse((o: any) => { if (o.userData.rockCells) { out.push(o); } }); return out; };
    assert.equal(rockMeshes().reduce((n, o) => (n + o.userData.rockCells), 0), rocks.length, "a block per rock cell");
    const tris = rockMeshes().reduce((n, o) => (n + (o.geometry.index.count / 3)), 0);
    console.log("grey rock relief: " + rocks.length + " cells, " + tris + " triangles");
    const i0 = rocks[0], ch = Math.floor(w.xy(i0)[0] / 8), meshOf = () => rockMeshes().find(o => (o.parent === t.pchunks[ch]));
    const before = Array.from(meshOf().geometry.getAttribute("position").array as Float32Array);
    w.hits[i0] = 1; t.touch(i0); t.update();
    assert.notDeepEqual(Array.from(meshOf().geometry.getAttribute("position").array as Float32Array), before, "a hit shows the next stage");

    // Frame budget: with almost none, the first update carves at most a
    // block and leaves the rest as textured boxes; later updates carry on
    // until every rock cell is carved.
    //
    const t2 = new Terrain(w, models());
    t2.carveMs = 0.001;
    const carved = () => { let n = 0; t2.props.traverse((o: any) => { if (o.userData.rockCells) { n += o.userData.rockCells; } }); return n; };
    t2.update();
    assert.ok(carved() <= 1, "first update carves at most one block: " + carved());
    let k = 0;
    while ( (carved() < rocks.length) && (k < 2000) ) { t2.update(); k++; }
    assert.equal(carved(), rocks.length, "later updates carve the rest");
  }
  finally { Object.assign(V, saved); }
});

test("leaf flakes drift: flat, slowed by drag, still on the floor and gone in time (D11.16)", async () => {
  const { Chips } = await import("../src/client/chips.ts");
  const THREE = await import("three");
  const c = new Chips(), col = [new THREE.Color(0, 0.5, 0.1)];
  c.burst(0, 1.5, 0, 6, 0.7, col, 1, 0.09, { flat: 0.15, gravity: 2.2, drag: 2.5, life: 1.0 });
  const rock = new Chips();
  rock.burst(0, 1.5, 0, 6, 0.7, col, 1);
  c.update(0.2); rock.update(0.2);
  const fall = (k: InstanceType<typeof Chips>) => Math.max(...k.chips.map(ch => -ch.v.y));
  assert.ok(fall(c) < fall(rock), "leaves fall slower than stone chips");
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  c.mesh.getMatrixAt(0, m); m.decompose(p, q, s);
  assert.ok(s.y < (0.3 * s.x), "flat");
  let low = Infinity;
  for (let k = 0; k < 40; k++) { c.update(0.05); for (const ch of c.chips) { low = Math.min(low, ch.p.y); } }
  assert.ok(low >= 1, "never below the floor");
  assert.equal(c.mesh.count, 0, "all gone");
});

test("derailment blast: voxel fire cools and shrinks, junk streams trails, smoke outlasts it, the shake dies away (D11.18)", async () => {
  const { Blast, fireColour, shake } = await import("../src/client/blast.ts");
  const THREE = await import("three");
  const hot = fireColour(0), cold = fireColour(1);
  assert.ok( (hot.r > 1) && (hot.g > 1), "starts bright enough to glow" );
  assert.ok( (cold.r < 0.2) && (cold.g < 0.1), "ends dark" );
  const b = new Blast();
  b.burst(5, 1, 3);
  let fireGone = -1, smokeGone = -1, rose = false, trails = 0, cols = new Set<number>(), far = 0;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let k = 1; k <= 80; k++) {
    b.update(0.05);
    if ( b.flames.some(f => (f.p.y > 2)) ) { rose = true; }
    trails = Math.max(trails, b.trails.length);
    for (const t of b.trails) { cols.add(t.col); far = Math.max(far, Math.hypot(t.p.x - 5, t.p.z - 3)); }
    if ( (fireGone < 0) && !b.flames.length ) { fireGone = k * 0.05; }
    if ( (smokeGone < 0) && !b.puffs.length ) { smokeGone = k * 0.05; }

    // Fire cubes sit on the 1/16 grid, square to the axes.
    //
    for (let i = 0; i < b.fire.count; i++) {
      b.fire.getMatrixAt(i, m); m.decompose(p, q, s);
      assert.ok( (Math.abs((p.x * 16) - Math.round(p.x * 16)) < 1e-6) && (Math.abs(q.w) > (1 - 1e-9)) && (Math.abs((s.x * 16) - Math.round(s.x * 16)) < 1e-6) );
    }
  }
  assert.ok(rose, "flames rise");
  assert.ok(trails > 20, "junk streams trails: " + trails);
  assert.deepEqual([...cols].sort(), [0, 1, 2], "red, yellow and grey trails");
  assert.ok(far > 1, "trails reach out from the blast: " + far.toFixed(2));
  assert.ok( (fireGone > 0) && (fireGone <= 1.5), "fire gone within 1.5 s: " + fireGone );
  assert.ok( (smokeGone > fireGone) && (smokeGone <= 3.5), "smoke lasts longer, gone within 3.5 s: " + smokeGone );
  assert.ok(!b.active);
  assert.ok(shake(0.05).length() > 0.05, "shakes at first");
  assert.equal(shake(0.9).length(), 0, "still after");
  assert.equal(shake(-1).length(), 0, "none without a derailment");
});

test("mining chips: a burst flies up, lands on the floor, and is gone within its life (D11.16)", async () => {
  const { Chips } = await import("../src/client/chips.ts");
  const THREE = await import("three");
  const c = new Chips(), col = [new THREE.Color(0.5, 0.5, 0.5)];
  c.burst(2.5, 1.5, 3.5, 10, 1.2, col, 1);
  assert.equal(c.chips.length, 10);
  c.update(0.05);
  assert.equal(c.mesh.count, 10);
  assert.ok(c.chips.some(k => (k.p.y > 1.5)), "chips fly up");
  let low = Infinity;
  for (let k = 0; k < 15; k++) { c.update(0.05); for (const ch of c.chips) { low = Math.min(low, ch.p.y - (ch.size / 2)); } }
  assert.ok(low >= (1 - 1e-9), "chips never sink below the floor");
  for (let k = 0; k < 40; k++) { c.update(0.05); }
  assert.equal(c.mesh.count, 0, "all chips gone");
});

test("built client modules parse as JavaScript", () => {
  const web = join(ROOT, "web");
  execFileSync(process.execPath, [join(ROOT, "tools/build.ts"), web], { stdio: "pipe" });
  const walk = (d: string): string[] => readdirSync(d).flatMap(e => {
    const p = join(d, e);
    return ( statSync(p).isDirectory() ? walk(p) : ( p.endsWith(".js") ? [p] : [] ) );
  });
  const files = walk(join(web, "src"));
  assert.ok(files.length > 15);
  for (const f of files) { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
});

// Greedy meshing must cover exactly the exposed voxel faces: per face
// direction, the merged quads' area equals the count of exposed faces,
// and every quad winds to face its normal.
//
test("greedy voxel meshes cover exactly the exposed faces", () => {
  for (const f of [G + "train-v3-x2.vox", K + "tree-7.vox", G + "ramp-0.vox", G + "grass-1.vox", G + "item-ore-0.vox"]) {
    const m = vox(f), g = voxGeometry(m), pos = g.getAttribute("position"), nor = g.getAttribute("normal"), idx = g.index!;
    const area = new Map<string, number>(), want = new Map<string, number>();
    for (let t = 0; t < idx.count; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      const p = (k: number) => [pos.getX(k), pos.getY(k), pos.getZ(k)];
      const A = p(a), B = p(b), C = p(c), e1 = B.map((x, k) => x - A[k]), e2 = C.map((x, k) => x - A[k]);
      const cr = [(e1[1] * e2[2]) - (e1[2] * e2[1]), (e1[2] * e2[0]) - (e1[0] * e2[2]), (e1[0] * e2[1]) - (e1[1] * e2[0])];
      const n = [nor.getX(a), nor.getY(a), nor.getZ(a)], key = n.join(",");
      assert.ok( ((cr[0] * n[0]) + (cr[1] * n[1]) + (cr[2] * n[2])) > 0, f + ": a triangle faces away from its normal" );
      area.set(key, (area.get(key) ?? 0) + (Math.hypot(cr[0], cr[1], cr[2]) / 2) / (VOXEL * VOXEL));
    }
    const dirs: [number[], string][] = [[[1, 0, 0], "1,0,0"], [[-1, 0, 0], "-1,0,0"], [[0, 1, 0], "0,0,1"], [[0, -1, 0], "0,0,-1"], [[0, 0, 1], "0,1,0"], [[0, 0, -1], "0,-1,0"]];
    for (let z = 0; z < m.sz; z++) {
      for (let y = 0; y < m.sy; y++) {
        for (let x = 0; x < m.sx; x++) {
          if (!voxGet(m, x, y, z)) { continue; }
          for (const [d, key] of dirs) {
            if (!voxGet(m, x + d[0], y + d[1], z + d[2])) { want.set(key, (want.get(key) ?? 0) + 1); }
          }
        }
      }
    }
    for (const [key, n] of want) { assert.ok(Math.abs((area.get(key) ?? 0) - n) < 1e-3, f + " " + key + ": area " + area.get(key) + " vs faces " + n); }
  }
});
