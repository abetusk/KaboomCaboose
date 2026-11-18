// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Grey rock relief (D11.14). Sets how grey rock blocks are carved and
// shows the result. Each grey rock cell is one carved voxel block
// (brickBlock in src/assets/bricks.ts): its top and every exposed side
// cut their stone pattern into a solid block, edges and corners
// included, and exposed edges are worn in short runs. There are 2048
// blocks (8 patterns x 4 mining stages x 4 variants x 16 sets of exposed
// sides), so rather than shipping them as files the game carves the
// ones a level needs, with the same function and the settings written
// here.
//
//   node tools/brickvox.ts [--heights 1,3,3,1] [--border 0] [--chip 0.35] [--vox DIR]
//
// --heights: relief height in voxels for each class (joint, stone face,
//   lit edge, crack). One voxel is 1/32 of a cell. Joints and cracks are
//   cut (deepest height - height) voxels deep. Default 1,3,3,1.
// --border: width in voxels of a joint ring around each top and at both
//   ends of each side, so cells read apart; default 0 (none).
// --chip: share of short runs of edge voxels worn away on exposed edges
//   (0 to 1); default 0.35.
// --vox: also write each pattern's stage 0, variant 0 block with every
//   side exposed, as DIR/rock-block-u<u>.vox, for viewing elsewhere.
// Output: assets/generated/rock-relief.json (the settings) and
// assets/preview/rock-relief.png (a small rock patch).
//

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { writeVox, VoxModel } from "../src/vox/vox.ts";
import { renderScene } from "../src/vox/render.ts";
import { CELL, palette, brickColourIndex } from "../src/assets/terrain.ts";
import { BRICK_CARVE, BRICK_RELIEF_VARIANTS, BLOCK_XY, BLOCK_Z, brickBlock, type CarveOpts } from "../src/assets/bricks.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), ".."), GEN = join(ROOT, "assets", "generated");

function args(argv: string[]): { o: CarveOpts, vox: string | null } {
  const o = { ...BRICK_CARVE };
  let vox: string | null = null;
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k], v = argv[k + 1];
    if      (a === "--heights") { o.heights = v.split(",").map(Number); k++; }
    else if (a === "--border")  { o.border  = Number(v); k++; }
    else if (a === "--chip")    { o.chip    = Number(v); k++; }
    else if (a === "--vox")     { vox       = v; k++; }
    else                        { throw new Error("unknown argument " + a); }
  }
  if ( (o.heights.length !== 4) || o.heights.some(h => ( !Number.isInteger(h) || (h < 0) || (h > 8) )) ) {
    throw new Error("--heights needs four whole numbers in 0..8");
  }
  if ( !Number.isInteger(o.border) || (o.border < 0) || (o.border > 4) ) { throw new Error("--border must be 0..4"); }
  if ( !(o.chip >= 0) || (o.chip > 1) ) { throw new Error("--chip must be in 0..1"); }
  return { o, vox };
}

const { o, vox } = args(process.argv.slice(2));
const tiles: string[] = JSON.parse(readFileSync(join(GEN, "rock-bricks.json"), "utf8")).tiles;
writeFileSync(join(GEN, "rock-relief.json"), JSON.stringify({
  license  : "CC0-1.0",
  note     : "Grey rock carving settings, from tools/brickvox.ts; the game carves blocks with brickBlock (src/assets/bricks.ts). heights: voxels by class (joint, stone face, lit edge, crack).",
  heights  : o.heights,
  border   : o.border,
  chip     : o.chip,
  stages   : 4,
  variants : BRICK_RELIEF_VARIANTS,
}, null, 1) + "\n");

// A carved block as a model in the shared palette.
//
const model = (b: Uint8Array): VoxModel => {
  const m = new VoxModel(BLOCK_XY, BLOCK_XY, BLOCK_Z, palette());
  b.forEach((c, k) => { if (c) { m.v[k] = brickColourIndex(c - 1); } });
  return m;
};
if (vox) {
  mkdirSync(vox, { recursive: true });
  tiles.forEach((t, u) => writeVox(join(vox, "rock-block-u" + u + ".vox"), model(brickBlock(t, 0, 0, 15, o))));
}

// Preview: a 5 x 4 rock patch (one corner cell missing) on a ground
// slab, one pattern per 2 x 2 block of cells, the right-hand column
// cracked by mining stages 1 to 3, each cell carved for its own exposed
// sides as the game does.
//
const W = 5, H = 4, M = 8,
      scene = new VoxModel((W * CELL) + (2 * M), (H * CELL) + (2 * M), 2 + BLOCK_Z, palette()),
      rock = (x: number, y: number) => ( (x >= 0) && (y >= 0) && (x < W) && (y < H) && !( (x === (W - 1)) && (y === 0) ) );
for (let y = 0; y < scene.sy; y++) { for (let x = 0; x < scene.sx; x++) { scene.set(x, y, 0, 0x01); scene.set(x, y, 1, 0x01); } }
const DIR: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
for (let cy = 0; cy < H; cy++) {
  for (let cx = 0; cx < W; cx++) {
    if (!rock(cx, cy)) { continue; }
    let ex = 0;
    DIR.forEach(([dx, dy], d) => { if (!rock(cx + dx, cy + dy)) { ex |= (1 << d); } });
    const u = ((Math.floor(cx / 2) + (2 * Math.floor(cy / 2))) % tiles.length), s = ( (cx === (W - 1)) ? (cy % 4) : 0 ),
          b = model(brickBlock(tiles[u], s, (cx + (3 * cy)) % BRICK_RELIEF_VARIANTS, ex, o));
    for (let z = 0; z < BLOCK_Z; z++) {
      for (let y = 0; y < BLOCK_XY; y++) {
        for (let x = 0; x < BLOCK_XY; x++) { const c = b.get(x, y, z); if (c) { scene.set(M + (cx * CELL) + x, M + (cy * CELL) + y, 2 + z, c); } }
      }
    }
  }
}
mkdirSync(join(ROOT, "assets", "preview"), { recursive: true });
writeFileSync(join(ROOT, "assets", "preview", "rock-relief.png"), renderScene([{ m: scene, ox: 0, oy: 0, oz: 0 }], 4).png());
console.log("rock relief: heights", o.heights.join(","), "border", o.border, "chip", o.chip, "; preview written");
