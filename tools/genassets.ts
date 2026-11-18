// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Generate the terrain voxel models, copy the Kytric and Kenney models
// the game uses, and write preview images plus a self-contained gallery
// page.
//
//   node tools/genassets.ts [--kytric DIR] [--kenney DIR] [--mehrasaur FILE]
//
// --kytric is Kytric's extracted "vox" folder (default
// ~/claude/models/kytric/vox); --kenney is Kenney's extracted Mini
// Characters folder (default ~/claude/models/kenney); --mehrasaur is
// model 10 of mehrasaur's Voxel Buildings (default
// ~/claude/models/mehrasaur/dist/vox/10.vox).
// Output: assets/generated/, assets/third_party/{kytric,kenney,mehrasaur}/,
// assets/preview/.
//

import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { readVox, writeVox, type VoxModel } from "../src/vox/vox.ts";
import { renderScene, type Placed, type Tri } from "../src/vox/render.ts";
import * as T from "../src/assets/terrain.ts";
import { readGlb, glbTris } from "../src/assets/glb.ts";
import * as St from "../src/assets/station.ts";
import { decodePng } from "../src/vox/png.ts";
import { CARVED_SOURCE, carvedBlocks } from "../src/assets/carved.ts";
import { BRICK_SOURCE, BRICK_UNITS, brickTile } from "../src/assets/bricks.ts";
import { Cell, CELL_NAMES, DIR_NAMES } from "../src/level/cells.ts";
import { DIR_FLAGS } from "../src/level/tiled.ts";

const ROOT   = join(dirname(new URL(import.meta.url).pathname), ".."),
      GEN    = join(ROOT, "assets", "generated"),
      THIRD  = join(ROOT, "assets", "third_party", "kytric"),
      KENNEY = join(ROOT, "assets", "third_party", "kenney"),
      MEHRA  = join(ROOT, "assets", "third_party", "mehrasaur"),
      PREV   = join(ROOT, "assets", "preview");

// Kytric models used by the game, relative to Kytric's vox folder.
//
// Locomotives v1-v3 and wagons v1-v9, each in Kytric's six colourings
// (the plain file plus blue, green, orange, red, yellow).
//
const COLOURS = ["", "-blue", "-green", "-orange", "-red", "-yellow"];
const LOCOS   = [1, 2, 3].flatMap(v => COLOURS.map(c => "train-v" + v + c));
const WAGONS  = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(v => COLOURS.map(c => "train-trailer-v" + v + c));

const KYTRIC = [
  ...LOCOS.map(n => "Trains/" + n + ".vox"),
  ...WAGONS.map(n => "TrainTrailers/" + n + ".vox"),
  "Trees/tree-1.vox", "Trees/tree-2.vox", "Trees/tree-3.vox", "Trees/tree-4.vox",
  "Trees/tree-5.vox", "Trees/tree-6.vox", "Trees/tree-7.vox", "Trees/tree-8.vox",
  "Stones/stone-1.vox", "Stones/stone-2.vox", "Stones/stone-3.vox",
  "Stones/stone-4.vox", "Stones/stone-5.vox", "Stones/stone-6.vox",
  "Wood/wood-1.vox", "Wood/wood-2.vox",
  "Bushes/bush-1.vox", "Bushes/bush-2.vox", "Bushes/bush-3.vox",
];

// Kenney Mini Characters used as player characters. One glTF unit is
// one cell: the characters are about 0.77 cells wide and 0.7-0.85 cells
// tall, so each fills most of its cell.
//
const CHARACTERS = ["knight", "zombie", "robot"];
const CHAR_SCALE = T.CELL;

const VARIANTS = 4;

interface Entry {
  file    : string;
  kind    : string;
  variant : number;
  stage   : number | null;
  size    : [number, number, number];
}

function main(): void {
  const args = process.argv.slice(2),
        ki   = args.indexOf("--kytric"),
        ksrc = ( (ki >= 0) ? args[ki + 1] : join(homedir(), "claude", "models", "kytric", "vox") ),
        ni   = args.indexOf("--kenney"),
        nsrc = ( (ni >= 0) ? args[ni + 1] : join(homedir(), "claude", "models", "kenney") ),
        hi   = args.indexOf("--mehrasaur"),
        hsrc = ( (hi >= 0) ? args[hi + 1] : join(homedir(), "claude", "models", "mehrasaur", "dist", "vox", "10.vox") );

  for (const d of [GEN, THIRD, PREV, MEHRA, join(KENNEY, "Textures")]) { mkdirSync(d, { recursive: true }); }

  // Copy mehrasaur's building 10 (CC0), the station building's source.
  //
  if (existsSync(hsrc)) { copyFileSync(hsrc, join(MEHRA, "10.vox")); }
  else if (!existsSync(join(MEHRA, "10.vox"))) { throw new Error("missing mehrasaur model " + hsrc); }

  // Copy Kenney characters (CC0), keeping the texture at the relative
  // path the .glb files name.
  //
  const kenneyFiles = [...CHARACTERS.map(c => "character-" + c + ".glb"), "Textures/colormap.png"];
  for (const f of kenneyFiles) {
    const src = join(nsrc, "Models", "GLB format", f), dst = join(KENNEY, f);
    if (existsSync(src)) { copyFileSync(src, dst); }
    else if (!existsSync(dst)) { throw new Error("missing Kenney model " + src); }
  }
  if (existsSync(join(nsrc, "License.txt"))) { copyFileSync(join(nsrc, "License.txt"), join(KENNEY, "License.txt")); }
  const chars = CHARACTERS.map(c => ({ name: c, path: join(KENNEY, "character-" + c + ".glb"), g: readGlb(join(KENNEY, "character-" + c + ".glb")) }));
  const charTris = (k: number, ox: number, oy: number, oz: number): Tri[] => glbTris(chars[k].g, chars[k].path, CHAR_SCALE, ox, oy, oz);

  // Copy Kytric models (CC0).
  //
  for (const f of KYTRIC) {
    const src = join(ksrc, f), dst = join(THIRD, f.split("/")[1]);
    if (existsSync(src)) { copyFileSync(src, dst); }
    else if (!existsSync(dst)) { throw new Error("missing Kytric model " + src); }
  }
  const K = (name: string) => readVox(join(THIRD, name));

  // Generated models.
  //
  const manifest = [] as Entry[];
  const saveAs = (m: VoxModel, kind: string, file: string) => {
    writeVox(join(GEN, file), m);
    manifest.push({ file, kind, variant: manifest.filter(e => (e.kind === kind)).length, stage: null, size: [m.sx, m.sy, m.sz] });
    return m;
  };
  const save = (m: VoxModel, kind: string, variant: number, stage: number | null) => {
    const file = kind + "-" + variant + ( (stage !== null) ? ("-s" + stage) : "" ) + ".vox";
    writeVox(join(GEN, file), m);
    manifest.push({ file, kind, variant, stage, size: [m.sx, m.sy, m.sz] });
    return m;
  };
  const made: Record<string, VoxModel[]> = {};
  const add = (k: string, m: VoxModel) => { (made[k] ??= []).push(m); };

  for (let v = 0; v < VARIANTS; v++) {
    add("ground",    save(T.ground(100 + v), "ground", v, null));
    add("forest",    save(T.forestFloor(200 + v), "forest-floor", v, null));
    add("black",     save(T.blackRock(400 + v), "black-rock", v, null));
    add("ramp",      save(T.ramp(600 + v), "ramp", v, null));
    add("bridge",    save(T.bridge(700 + v), "bridge", v, null));
    for (let s = 0; s < T.ROCK_STAGES; s++) {
      add("rock-s" + s, save(T.greyRock(300 + v, s), "grey-rock", v, s));
    }
  }
  for (let v = 0; v < 2; v++) {
    add("water", save(T.water(500 + v), "water", v, null));
    add("stump", save(T.stump(800 + v), "stump", v, null));
  }
  add("trackStraight", save(T.trackStraight(), "track-straight", 0, null));
  add("trackCurve",    save(T.trackCurve(), "track-curve", 0, null));
  add("trackSlope",    save(T.slopedTrack(T.trackStraight()), "track-ramp", 0, null));

  // Items carried and stacked, and grass tufts for ground variety.
  //
  for (let v = 0; v < 2; v++) {
    add("woodItem", save(T.woodCube(1000 + v), "item-wood", v, null));
    add("oreItem",  save(T.oreCube(1100 + v), "item-ore", v, null));
  }
  for (let v = 0; v < 6; v++) { add("grass", save(T.grassTuft(1200 + v), "grass", v, null)); }

  // Visual extras (D11.11): detailed ground tops, banded black rock,
  // boulders for grey rock (sizes 0 big, 1 medium, 2 small; built at
  // half resolution and drawn at 2x, which keeps their triangle count
  // down), crags for black rock tops, and ground details.
  //
  for (let v = 0; v < VARIANTS; v++) {
    add("groundDetail", save(T.groundDetail(1300 + v), "ground-detail", v, null));
    add("blackStrata",  save(T.blackStrata(1400 + v), "black-strata", v, null));
  }
  const BOULDER_R = [5, 3.5, 2];
  BOULDER_R.forEach((r, s) => {
    for (let v = 0; v < 4; v++) { add("boulder", save(T.boulder(1500 + (10 * s) + v, r), "boulder", v, s)); }
  });
  for (let v = 0; v < 6; v++) { add("crag", save(T.crag(1600 + v, 10 + (v * 4), 4 + (v % 3) * 2), "crag", v, null)); }
  for (let v = 0; v < 3; v++) {
    add("pebbles", save(T.pebbles(1700 + v), "pebbles", v, null));
    add("flowers", save(T.flowers(1710 + v), "flowers", v, null));
    add("leaves",  save(T.leaves(1720 + v), "leaves", v, null));
    add("gravel",  save(T.gravel(1730 + v), "gravel", v, null));
    add("bush",    save(T.bush(1740 + v), "bush", v, null));
  }
  // Carved black rock (D11.13): the 16 blocks of etqws3's orange panel as
  // class maps for the client. The relief blocks come from
  // tools/carvevox.ts.
  //
  {
    const blocks = carvedBlocks(decodePng(readFileSync(join(ROOT, CARVED_SOURCE))));
    writeFileSync(join(GEN, "carved-blocks.json"), JSON.stringify({
      license : "CC0-1.0",
      source  : "etqws3, Square Block Textures, https://opengameart.org/content/square-block-textures (CC0); see src/assets/carved.ts",
      note    : "16 blocks (row-major in the 4 x 4 panel), each 256 class digits row by row: 0 hole, 1 groove, 2 base, 3 lit, 4 highlight.",
      blocks,
    }, null, 1) + "\n");
  }

  // Brick grey rock (D11.14): the chosen Techno Bricks units' body tiles
  // as class maps; `tile` (the first) is the flat texture.
  //
  {
    const sheet = decodePng(readFileSync(join(ROOT, BRICK_SOURCE))), tiles = BRICK_UNITS.map(u => brickTile(sheet, u));
    writeFileSync(join(GEN, "rock-bricks.json"), JSON.stringify({
      license : "CC0-1.0",
      source  : "SpiderDave, Techno Bricks, https://opengameart.org/content/techno-bricks (CC0); see src/assets/bricks.ts",
      note    : "Body tiles of units (row, column) as 256 class digits row by row: 0 joint, 1 stone face, 2 lit edge. `tile` is the first.",
      units   : BRICK_UNITS,
      tile    : tiles[0],
      tiles,
    }, null, 1) + "\n");
  }

  for (let v = 0; v < 3; v++) {
    add("vine",         save(T.vine(1800 + v), "vine", v, null));
    add("side-stone",   save(T.sideStone(1810 + v), "side-stone", v, null));
    add("grass-fringe", save(T.grassFringe(1820 + v), "grass-fringe", v, null));
  }

  // The station building, from mehrasaur's CC0 model 10.
  //
  const house = St.stationHouse(join(MEHRA, "10.vox"));
  writeVox(join(GEN, "station-house.vox"), house);

  // Kytric's train and wagons, scaled to TRAIN_SCALE to match the track.
  //
  for (const n of LOCOS)  { add("train",   saveAs(T.scaleUp(K(n + ".vox"), T.TRAIN_SCALE), "locomotive", n + "-x" + T.TRAIN_SCALE + ".vox")); }
  for (const n of WAGONS) { add("trailer", saveAs(T.scaleUp(K(n + ".vox"), T.TRAIN_SCALE), "wagon", n + "-x" + T.TRAIN_SCALE + ".vox")); }

  writeFileSync(join(GEN, "manifest.json"), JSON.stringify({
    license : "CC0-1.0",
    cell    : T.CELL,
    level   : T.LEVEL,
    note    : "Generated by tools/genassets.ts. Axes x, y horizontal, z up. Ramps and sloped track rise toward +x.",
    models  : manifest,
  }, null, 1) + "\n");

  // Previews.
  //
  const trees = [1, 2, 3, 4, 5, 6, 7, 8].map(i => K("tree-" + i + ".vox"));
  const shots = [] as { name: string, caption: string, png: Buffer }[];
  const shot = (name: string, caption: string, items: Placed[], s: number, tris: Tri[] = []) => {
    const png = renderScene(items, s, tris).png();
    writeFileSync(join(PREV, name + ".png"), png);
    shots.push({ name, caption, png });
  };
  const C0 = T.CELL, L0 = T.LEVEL;
  const row = (ms: VoxModel[], gap = 8): Placed[] => ms.map((m, i) => ({ m, ox: i * (T.CELL + gap), oy: 0, oz: 0 }));

  // A forest cell at chop stage k: the first (9 - 3k) tree spots keep
  // trees, the rest show stumps.
  //
  const forestCell = (v: number, k: number, ox: number, oy: number, oz: number): Placed[] => {
    const out: Placed[] = [{ m: made.forest[v], ox, oy, oz }],
          spots = T.treeSpots(200 + v),
          keep  = Math.max(0, 9 - (3 * k));
    spots.forEach(([x, y], i) => {
      const t = ( (i < keep) ? trees[(i + v) % trees.length] : made.stump[i % 2] ),
            dx = Math.floor((6 - t.sx) / 2), dy = Math.floor((6 - t.sy) / 2);
      out.push({ m: t, ox: ox + x + dx, oy: oy + y + dy, oz: oz + T.LEVEL });
    });
    return out;
  };

  shot("ground", "Ground, 4 variants", row(made.ground), 3);
  shot("forest", "Forest cell, chop stages 0-3 (trees thin out, stumps remain)",
       [0, 1, 2, 3].flatMap(k => forestCell(k % VARIANTS, k, k * 40, 0, 0)), 3);
  shot("grey-rock-stages", "Grey rock, mining stages 0-3 (same block, cracks accumulate)",
       row([0, 1, 2, 3].map(s => made["rock-s" + s][0])), 3);
  shot("grey-rock-variants", "Grey rock, 4 variants at stage 0",
       row([0, 1, 2, 3].map(v => made["rock-s0"][v])), 3);
  shot("black-rock", "Black rock, 4 variants", row(made.black), 3);
  shot("water", "Water, 2 variants", row(made.water), 3);
  shot("ramp", "Ramp (grey rock, uphill toward the right-front), with track", [
    { m: made.ramp[0], ox: 0, oy: 0, oz: 0 },
    { m: made.ramp[1], ox: 40, oy: 0, oz: 0 },
    { m: made.trackSlope[0], ox: 40, oy: 0, oz: 0 },
  ], 3);
  shot("track", "Track (generated, gauge matched to the 2x train): straight, curve, on a ramp; train on straight track", [
    { m: made.ground[0], ox: 0, oy: 0, oz: 0 },  { m: made.trackStraight[0], ox: 0, oy: 0, oz: L0 },
    { m: made.ground[1], ox: C0, oy: 0, oz: 0 }, { m: made.trackStraight[0], ox: C0, oy: 0, oz: L0 },
    { m: made.train[0], ox: 4, oy: T.TRAIN_Y, oz: L0 + T.TRACK_TOP },
    { m: made.ground[2], ox: 0, oy: C0 + 8, oz: 0 }, { m: made.trackCurve[0], ox: 0, oy: C0 + 8, oz: L0 },
    { m: made.ground[3], ox: C0 + 8, oy: C0 + 8, oz: 0 }, { m: made.ramp[2], ox: C0 + 8, oy: C0 + 8, oz: L0 },
    { m: made.trackSlope[0], ox: C0 + 8, oy: C0 + 8, oz: L0 },
  ], 3);
  shot("bridge", "Bridge deck, 2 variants", row(made.bridge.slice(0, 2)), 3);

  // Vehicle types, plain colouring: locomotives v1-v3 then wagons v1-v9,
  // one per row so they do not hide each other.
  //
  const plain = (n: string) => n.split("-").every(p => !["blue", "green", "orange", "red", "yellow"].includes(p));
  const vehicles = [...made.train.filter((_, i) => plain(LOCOS[i])), ...made.trailer.filter((_, i) => plain(WAGONS[i]))];
  shot("vehicles", "Locomotives v1-v3 and wagons v1-v9 (2x, plain colouring)",
       vehicles.map((m, i) => ({ m, ox: (i % 3) * 72, oy: Math.floor(i / 3) * 24, oz: 0 })), 2);

  // Characters: Kenney's knight, zombie and robot in their rest pose,
  // each on its own ground cell.
  //
  shot("characters", "Characters (Kenney Mini Characters): knight, zombie, robot, each on one cell, facing +x",
       [0, 1, 2].map(i => ({ m: made.ground[i], ox: 0, oy: i * (T.CELL + 4), oz: 0 })), 4,
       [0, 1, 2].flatMap(i => charTris(i, T.CELL / 2, (i * (T.CELL + 4)) + (T.CELL / 2), T.LEVEL)));

  // Characters at game scale, beside forest, grey rock and the train.
  //
  shot("character-scale", "Characters at game scale: one cell each, next to forest, grey rock and a 2x locomotive", [
    ...[0, 1, 2, 3].map(i => ({ m: made.ground[i], ox: i * T.CELL, oy: 0, oz: 0 })),
    ...[0, 1, 2, 3].map(i => ({ m: made.ground[(i + 1) % 4], ox: i * T.CELL, oy: T.CELL, oz: 0 })),
    ...forestCell(0, 1, 0, 0, 0),
    { m: made["rock-s0"][0], ox: 3 * T.CELL, oy: 0, oz: T.LEVEL },
    { m: made.trackStraight[0], ox: 0, oy: T.CELL, oz: T.LEVEL }, { m: made.trackStraight[0], ox: T.CELL, oy: T.CELL, oz: T.LEVEL },
    { m: made.train[2], ox: 4, oy: T.CELL + T.TRAIN_Y, oz: T.LEVEL + T.TRACK_TOP },
  ], 3, [
    ...charTris(0, 1.5 * T.CELL, 0.5 * T.CELL, T.LEVEL),
    ...charTris(1, 2.5 * T.CELL, 0.5 * T.CELL, T.LEVEL),
    ...charTris(2, 2.5 * T.CELL, 1.5 * T.CELL, T.LEVEL),
  ]);

  // Station: three station cells with track, the station building on
  // the two rows behind, a character waiting.
  //
  shot("station", "Station: three cells with track, the station building (mehrasaur's Voxel Buildings model 10, CC0) on the two rows behind", [
    ...[0, 1, 2].flatMap(r => [0, 1, 2, 3].map(i => ({ m: made.ground[(i + (2 * r)) % 4], ox: i * T.CELL, oy: r * T.CELL, oz: 0 }))),
    { m: house, ox: Math.round((1.5 * T.CELL) - (house.sx / 2)), oy: (2 * T.CELL) - house.sy - Math.round(T.CELL / 8), oz: T.LEVEL },
    ...[0, 1, 2].map(i => ({ m: made.trackStraight[0], ox: i * T.CELL, oy: 2 * T.CELL, oz: T.LEVEL })),
    { m: made.trailer[0], ox: 4, oy: (2 * T.CELL) + T.TRAIN_Y, oz: T.LEVEL + T.TRACK_TOP },
  ], 3, charTris(2, 3.5 * T.CELL, 2.5 * T.CELL, T.LEVEL));

  // Diorama: a few cells with heights, train on track climbing a ramp.
  //
  const L = T.LEVEL, C = T.CELL;
  // A column: h ground blocks, then `top` on them.
  //
  const col = (cx: number, cy: number, h: number, top: VoxModel): Placed[] => {
    const out = [] as Placed[];
    for (let k = 0; k < h; k++) { out.push({ m: made.ground[(cx + cy + k) % VARIANTS], ox: cx * C, oy: cy * C, oz: k * L }); }
    out.push({ m: top, ox: cx * C, oy: cy * C, oz: h * L });
    return out;
  };
  const track = made.trackStraight[0], train = made.train[1];
  // Rows from back (cy = 0) to front (cy = 2); the preview looks from the
  // front-right, so the track row goes last.
  //
  const scene: Placed[] = [
    ...col(0, 0, 0, made.water[0]),
    ...col(1, 0, 0, made.water[1]), { m: made.bridge[0], ox: C, oy: 0, oz: 0 },
    ...col(2, 0, 0, made["rock-s3"][0]),
    ...col(3, 0, 1, made.black[2]), { m: made.black[3], ox: 3 * C, oy: 0, oz: 2 * L },

    ...forestCell(0, 0, 0, C, 0),
    ...forestCell(1, 2, C, C, 0),
    ...col(2, 1, 0, made["rock-s2"][1]), { m: made["rock-s0"][2], ox: 2 * C, oy: C, oz: L },
    ...col(3, 1, 1, made.black[0]), { m: made.black[1], ox: 3 * C, oy: C, oz: 2 * L },

    ...col(0, 2, 0, made.ground[0]), { m: track, ox: 0, oy: 2 * C, oz: L },
    ...col(1, 2, 0, made.ground[1]), { m: track, ox: C, oy: 2 * C, oz: L },
    ...col(2, 2, 0, made.ground[2]), { m: made.ramp[0], ox: 2 * C, oy: 2 * C, oz: L }, { m: made.trackSlope[0], ox: 2 * C, oy: 2 * C, oz: L },
    ...col(3, 2, 1, made.ground[3]), { m: track, ox: 3 * C, oy: 2 * C, oz: 2 * L },
    { m: train, ox: Math.floor(((2 * C) - train.sx) / 2), oy: (2 * C) + T.TRAIN_Y, oz: L },
  ];
  shot("diorama", "Diorama: train on track up a ramp; forest (full, thinned); grey rock two high; black rock rising; water with a bridge; grey rock about to break", scene, 2);

  const charCards = chars.map((c, k) => ({
    name : c.name,
    img  : "data:image/png;base64," + renderScene([], 4, charTris(k, 0, 0, 0)).png().toString("base64"),
    g    : c.g,
  }));
  writeFileSync(join(PREV, "index.html"), gallery(shots, manifest, K, charCards, house));

  console.log("models:", manifest.length, "generated,", KYTRIC.length, "Kytric,", CHARACTERS.length, "Kenney; previews:", shots.length);
}

// What each generated model is for, and the level cell it draws (if any).
//
const KIND_INFO: Record<string, { title: string, cell: number | null, desc: string }> = {
  "ground"       : { title: "Ground", cell: Cell.GROUND,
                     desc: "Plain dirt. Walkable; track can be laid on it. Also the filler block under every raised cell." },
  "forest-floor" : { title: "Forest floor", cell: Cell.TREE,
                     desc: "Base block of a forest cell. Up to nine Kytric trees stand on it. Chopping removes trees one at a time and leaves stumps; gives wood." },
  "grey-rock"    : { title: "Grey rock", cell: Cell.ROCK,
                     desc: "Mineable; gives rock. Stages 0 (intact) to 3 (about to break) show mining progress; the stage is game state, not stored in level files. The top stays walkable. Can stack; mined from the top (D4.15)." },
  "black-rock"   : { title: "Black rock", cell: Cell.BLACKROCK,
                     desc: "Cannot be mined. The top is walkable and can carry track; climbed with ramps. Black rock regions rise toward their interior (mountains)." },
  "water"        : { title: "Water", cell: Cell.WATER,
                     desc: "Blocks avatars. Track crosses on a bridge (bridgeTrees trees per cell)." },
  "ramp"         : { title: "Ramp", cell: Cell.RAMP_GROUND,
                     desc: "Built by players from one grey rock, against a face exactly one level up; permanent. Track must run along it, entering at the low end. The model rises toward +x (east)." },
  "track-straight" : { title: "Track, straight", cell: Cell.TRACK,
                     desc: "Straight track along x, centred in the cell. Kytric's rail and sleeper pattern at 2x, matching the 2x train." },
  "track-curve"  : { title: "Track, curve", cell: Cell.TRACK,
                     desc: "Quarter turn inside one cell: enters at the west edge (x = 0) and leaves at the south edge (+y). Rotate for the other turns." },
  "track-ramp"   : { title: "Track on a ramp", cell: null,
                     desc: "Straight track bent up the ramp slope; drawn on a ramp cell that carries track. Rises toward +x (east)." },
  "locomotive"   : { title: "Locomotive (2x)", cell: null,
                     desc: "Kytric's locomotives v1-v3 in six colourings, scaled 2x. Place the origin at the track's origin plus (0, TRAIN_Y = 10, 0): the outer wheel rows sit on the rails." },
  "item-wood"    : { title: "Wood (item)", cell: null,
                     desc: "One wood, as carried and stacked: a cube half a cell on a side, bark on four sides, end grain on +-x. Stacks are columns of these at full size." },
  "item-ore"     : { title: "Ore (item)", cell: null,
                     desc: "One ore, as carried and stacked: a half-cell cube of grey stone with rust streaks and bright flecks." },
  "grass"        : { title: "Grass tuft", cell: null,
                     desc: "Decoration scattered on ground cells for variety; some carry a flower." },
  "ground-detail": { title: "Ground, detailed", cell: null,
                     desc: "Ground with a mottled top, loam blotches, pebble clusters and thin cracks (view.groundDetail)." },
  "black-strata" : { title: "Black rock, banded", cell: null,
                     desc: "Black rock with wavy horizontal bands on its sides (view.blackStrata)." },
  "boulder"      : { title: "Boulder", cell: null,
                     desc: "Grey rock drawn as boulders (view.rockBoulders): stage 0 big, 1 medium, 2 small." },
  "crag"         : { title: "Crag", cell: null,
                     desc: "Jagged spires placed on black rock tops (view.crags)." },
  "pebbles"      : { title: "Pebbles", cell: null, desc: "Ground detail: a few stones (view.groundDecor)." },
  "flowers"      : { title: "Flowers", cell: null, desc: "Ground detail: a small flower patch (view.groundDecor)." },
  "leaves"       : { title: "Fallen leaves", cell: null, desc: "Ground detail near forests (view.groundDecor)." },
  "gravel"       : { title: "Gravel", cell: null, desc: "Ground detail near grey rock (view.groundDecor)." },
  "bush"         : { title: "Bush", cell: null, desc: "Fills some empty tree spots in forests (view.treeVariety)." },
  "vine"         : { title: "Vine", cell: null, desc: "Face piece hanging from a black rock wall's top edge (view.faceDecor)." },
  "side-stone"   : { title: "Side stone", cell: null, desc: "Face piece: a stone sticking out of a dirt side (view.faceDecor)." },
  "grass-fringe" : { title: "Grass fringe", cell: null, desc: "Face piece: grass hanging over a forest ledge (view.faceDecor)." },
  "wagon"        : { title: "Wagon (2x)", cell: null,
                     desc: "Kytric's wagons v1-v9 in six colourings, scaled 2x. Same placement as the locomotives. Candidates for the different upgrade wagons." },
};

// Kytric models: role in the game and source pack.
//
const VEHICLES = "https://kytric.itch.io/voxel-vehicles",
      TERRAIN  = "https://kytric.itch.io/voxel-path-and-terrain";

function kytricInfo(file: string): { title: string, desc: string, src: string, cell: number | null } {
  if (file.startsWith("train-trailer")) { return { title: "Wagon (source)", desc: "Original scale; the game uses the 2x copy in assets/generated.", src: VEHICLES, cell: null }; }
  if (file.startsWith("train"))         { return { title: "Locomotive (source)", desc: "Original scale; the game uses the 2x copy in assets/generated.", src: VEHICLES, cell: null }; }
  if (file.startsWith("tree"))          { return { title: "Tree", desc: "Stands on forest floor; up to nine per forest cell, removed one at a time by chopping.", src: TERRAIN, cell: null }; }
  if (file.startsWith("stone"))         { return { title: "Stone", desc: "Carried rock and mining rubble.", src: TERRAIN, cell: null }; }
  if (file.startsWith("wood"))          { return { title: "Log", desc: "Carried wood.", src: TERRAIN, cell: null }; }
  if (file.startsWith("bush"))          { return { title: "Bush", desc: "Decoration.", src: TERRAIN, cell: null }; }
  return { title: file, desc: "", src: TERRAIN, cell: null };
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function tiledCode(cell: number | null): string {
  if (cell === null) { return "none (not a level cell)"; }
  return "<code>" + CELL_NAMES[cell] + "</code>, tile id " + cell + ", GID " + (cell + 1);
}

// One snapshot per model, scaled so small models are still visible.
//
function snap(m: VoxModel): string {
  const big = Math.max(m.sx, m.sy, m.sz),
        s   = ( (big >= 24) ? 3 : ( (big >= 12) ? 6 : 10 ) );
  return "data:image/png;base64," + renderScene([{ m, ox: 0, oy: 0, oz: 0 }], s).png().toString("base64");
}

function gallery(shots: { name: string, caption: string, png: Buffer }[], manifest: Entry[],
                 K: (name: string) => VoxModel,
                 charCards: { name: string, img: string, g: ReturnType<typeof readGlb> }[],
                 house: VoxModel): string {
  // Generation time, in UTC, shown at the top of the page.
  //
  const stamp   = new Date().toISOString(),
        rampGid = Cell.RAMP_GROUND + 1;
  const rampRows = DIR_NAMES.map((d, k) =>
    "<tr><td>" + d + "</td><td>" + ( ["turn so model +x points to −y", "as modelled (+x)", "turn so model +x points to +y", "turn so model +x points to −x"][k] ) +
    "</td><td><code>0x" + DIR_FLAGS[k].toString(16).padStart(8, "0") + "</code></td><td><code>" + (rampGid + DIR_FLAGS[k]) + "</code></td></tr>").join("");

  const codeRows = [] as string[];
  for (let c = 0; c < 9; c++) {
    const models = manifest.filter(e => (KIND_INFO[e.kind]?.cell === c)).map(e => e.kind);
    const uniq = [...new Set(models)];
    const extra = ( (c === Cell.TRACK) ? "track-ramp on ramps" :
                  ( (c === Cell.STATION) ? "ground with track; the station building beside it" :
                  ( (c === Cell.RAMP_BLACKROCK) ? "unused (one ramp type since D9.8 revision)" : "" ) ) );
    codeRows.push("<tr><td><code>" + CELL_NAMES[c] + "</code></td><td>" + c + "</td><td>" + (c + 1) + "</td><td>" +
                  esc([uniq.join(", "), extra].filter(Boolean).join("; ")) + "</td></tr>");
  }

  const card = (img: string, title: string, rows: [string, string][], desc: string) =>
    "<article class=\"card\"><div class=\"shot\"><img alt=\"" + esc(title) + "\" src=\"" + img + "\"></div><h3>" + esc(title) + "</h3><p>" + esc(desc) +
    "</p><dl>" + rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("") + "</dl></article>";

  const sections = [] as string[];
  for (const kind of Object.keys(KIND_INFO)) {
    const info  = KIND_INFO[kind],
          items = manifest.filter(e => (e.kind === kind));
    if (!items.length) { continue; }
    const vehicle = ( (kind === "locomotive") || (kind === "wagon") );
    const cards = items.map(e => card(snap(readVox(join(GEN, e.file))),
      ( vehicle ? e.file.replace(".vox", "") : (info.title + " " + e.variant + ( (e.stage !== null) ? (", stage " + e.stage) : "" )) ), [
      ["File", "<code>assets/generated/" + e.file + "</code>"],
      ["Size", e.size.join(" × ") + " voxels"],
      ["Variant", String(e.variant)],
      ...( (e.stage !== null) ? [["Stage", e.stage + " of " + (T.ROCK_STAGES - 1)] as [string, string]] : [] ),
      ["Tiled", tiledCode(info.cell)],
      ["License", ( ( (e.kind === "locomotive") || (e.kind === "wagon") ) ? "CC0-1.0 (Kytric model, scaled)" : "CC0-1.0 (generated)" )],
    ], "")).join("\n");
    sections.push("<section><h2>" + esc(info.title) + "</h2><p>" + esc(info.desc) + "</p><div class=\"grid\">" + cards + "</div></section>");
  }

  // Vehicles are shown scaled above; their originals are not repeated.
  //
  const kcards = KYTRIC.filter(f => !f.startsWith("Train")).map(f => {
    const file = f.split("/")[1], m = K(file), info = kytricInfo(file);
    return card(snap(m), info.title + ": " + file.replace(".vox", ""), [
      ["File", "<code>assets/third_party/kytric/" + file + "</code>"],
      ["Size", [m.sx, m.sy, m.sz].join(" × ") + " voxels"],
      ["Tiled", tiledCode(info.cell)],
      ["License", "CC0-1.0, Kytric, <a href=\"" + info.src + "\">" + info.src.replace("https://", "") + "</a>"],
    ], info.desc);
  }).join("\n");

  const ccards = charCards.map(c => {
    const sz = [0, 1, 2].map(k => ((c.g.max[k] - c.g.min[k]) * CHAR_SCALE).toFixed(1));
    return card(c.img, "Character: " + c.name, [
      ["File", "<code>assets/third_party/kenney/character-" + c.name + ".glb</code>"],
      ["Texture", "<code>assets/third_party/kenney/Textures/colormap.png</code> (shared)"],
      ["Size", sz[0] + " wide × " + sz[2] + " deep × " + sz[1] + " tall, in voxels at 1 glTF unit = 1 cell"],
      ["Triangles", String(c.g.tris.length)],
      ["Animations", c.g.animations.map(a => "<code>" + esc(a) + "</code>").join(" ")],
      ["Tiled", tiledCode(null)],
      ["License", "CC0-1.0, Kenney, <a href=\"https://kenney.nl/assets/mini-characters\">kenney.nl/assets/mini-characters</a>"],
    ], "Rigged mesh with built-in animations; the game loads the .glb with three.js. Shown in its rest pose.");
  }).join("\n");

  const scard = card(snap(house), "Station building", [
    ["File", "<code>assets/generated/station-house.vox</code>"],
    ["Source", "<code>assets/third_party/mehrasaur/10.vox</code>, unmodified"],
    ["Size", [house.sx, house.sy, house.sz].join(" × ") + " voxels"],
    ["Tiled", "none; stands on the two rows north of the station cells"],
    ["License", "CC0-1.0, Voxel Buildings by mehrasaur, <a href=\"https://opengameart.org/content/voxel-buildings\">opengameart.org/content/voxel-buildings</a>; ground plate removed, cropped, turned 180 degrees and scaled 2x."],
  ], "The station building: a small shop with a blue awning, its front turned to +y (the track); 1.75 cells square, 1.5 cells tall.");

  const figs = shots.map(s =>
    "<figure><img alt=\"" + esc(s.caption) + "\" src=\"data:image/png;base64," + s.png.toString("base64") + "\"><figcaption>" + esc(s.caption) + "</figcaption></figure>").join("\n");

  return `<!-- SPDX-License-Identifier: CC0-1.0 -->
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tile Gallery</title>
<style>
:root { --bg: #f4f1ea; --fg: #2b2620; --muted: #6b6258; --card: #ece8e0; --shot: #e2ddd2; --line: #d6cfc2; --link: #8a4b14; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #1d1b18; --fg: #ece6dc; --muted: #a59d92; --card: #2a2723; --shot: #34302b; --line: #3d3833; --link: #e0a060; } }
:root[data-theme="dark"] { --bg: #1d1b18; --fg: #ece6dc; --muted: #a59d92; --card: #2a2723; --shot: #34302b; --line: #3d3833; --link: #e0a060; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.45; }
main { max-width: 1200px; margin: 0 auto; padding: 16px; }
a { color: var(--link); }
h1 { margin: 8px 0 4px; } h2 { margin: 32px 0 4px; } h3 { margin: 8px 0 4px; font-size: 1rem; }
p { margin: 4px 0 12px; } .muted { color: var(--muted); }
nav a { margin-right: 12px; white-space: nowrap; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 0.9rem; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
.tablewrap { overflow-x: auto; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.card { background: var(--card); border-radius: 8px; padding: 10px; }
.card p { font-size: 0.85rem; color: var(--muted); margin: 0 0 6px; }
.shot { background: var(--shot); border-radius: 6px; display: flex; align-items: center; justify-content: center; min-height: 150px; padding: 6px; }
.shot img { max-width: 100%; max-height: 220px; image-rendering: pixelated; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 8px; margin: 6px 0 0; font-size: 0.8rem; }
dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
figure { margin: 0 0 16px; background: var(--card); padding: 12px; border-radius: 8px; }
figure img { max-width: 100%; height: auto; image-rendering: pixelated; display: block; }
figcaption { margin-top: 6px; font-size: 0.9rem; }
code { font-size: 0.85em; }
</style></head><body><main>
<h1>Tile gallery</h1>
<p class="muted">Generated by <code>tools/genassets.ts</code> on <time datetime="${stamp}">${stamp.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</time>. One cell is ${T.CELL} voxels across, one height level ${T.LEVEL} voxels. Axes: x, y horizontal, z up; snapshots look from +x +y. Generated models are CC0; Kytric and Kenney models are CC0 from the linked packs; the station building is CC0 (mehrasaur).</p>
<nav><a href="#codes">Tiled codes</a><a href="#scenes">Scenes</a><a href="#characters">Characters</a>${Object.keys(KIND_INFO).map(k => "<a href=\"#" + k + "\">" + esc(KIND_INFO[k].title) + "</a>").join("")}<a href="#station">Station building</a><a href="#kytric">Kytric</a></nav>

<h2 id="codes">Tiled codes</h2>
<p>Level files use the <code>cells.tsj</code> tileset. A cell's GID is its tile id + 1; GID 0 is open air. Only the top four bits of a GID are flags.</p>
<div class="tablewrap"><table><thead><tr><th>Cell</th><th>Tile id</th><th>GID</th><th>Models</th></tr></thead><tbody>${codeRows.join("")}</tbody></table></div>
<p>Ramp direction is stored in Tiled's flip flags. The unrotated ramp tile rises toward north (−y); the ramp model rises toward east (+x), so it is rotated about z to match:</p>
<div class="tablewrap"><table><thead><tr><th>Uphill</th><th>Model rotation</th><th>Flags</th><th>Ramp GID</th></tr></thead><tbody>${rampRows}</tbody></table></div>

<h2 id="scenes">Scenes</h2>
${figs}

<section id="characters"><h2>Characters</h2><p>Kenney's Mini Characters, unmodified, in <code>assets/third_party/kenney/</code>. Meshes rather than voxels; one glTF unit is one cell, so each character fills most of its cell. They face +z in glTF, shown here facing +x.</p><div class="grid">${ccards}</div></section>

${sections.map((sec, i) => sec.replace("<section>", "<section id=\"" + Object.keys(KIND_INFO).filter(k => manifest.some(e => (e.kind === k)))[i] + "\">")).join("\n")}

<section id="station"><h2>Station building</h2><p>Made from a CC0 third-party model, kept in <code>assets/third_party/mehrasaur/</code>.</p><div class="grid">${scard}</div></section>

<section id="kytric"><h2>Kytric models</h2><p>Unmodified copies, in <code>assets/third_party/kytric/</code>. The original-scale locomotives and wagons are there too, as the source of the 2x models above.</p><div class="grid">${kcards}</div></section>
</main></body></html>
`;
}

main();
