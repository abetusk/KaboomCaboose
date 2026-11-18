// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The level's terrain as meshes: one mesh of textured boxes per chunk of
// columns (D11.3), plus instanced trees, track, ramps, bridges and stacks.
// Rebuilt per chunk when cells change.
//
// Heights: a cell of height h is blocks 0..h, each half a cell tall, so
// its top (where characters stand) is at Y = (h + 1) / 2.
//

import * as THREE from "three";
import { Cell, DIRS, isRamp, LEVEL_Y } from "../level/cells.ts";
import { World, Item } from "../sim/world.ts";
import { CONFIG } from "../config.ts";
import { Atlas, BoxBuilder, voxGeometry, type Vox } from "./voxel.ts";
import { tileSheet, type TileSheet, type Mat } from "./tiles.ts";
import { BRICK_PALETTE, BRICK_CRACK, BLOCK_XY, BLOCK_Z, brickBlock, type CarveOpts } from "../assets/bricks.ts";

export { LEVEL_Y };
export const topY = (h: number) => ((h + 1) * LEVEL_Y);

const CHUNK = 8;

// Milliseconds a frame may spend rebuilding chunks outside the window
// (Terrain.update).
//
const BUILD_MS = 4;

// Track pieces in piles and in hands are drawn at this fraction of a
// full cell-sized piece.
//
export const TRACK_PILE = 0.7;

// Wood and ore models are half a cell on a side; this scales them to
// view.itemSize.
//
export function itemScale(): number {
  return CONFIG.view.itemSize / 0.5;
}

// Small stable hash for picking model variants per cell.
//
export function hash(i: number): number {
  let x = (i + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ( (x ^ (x >>> 16)) >>> 0 );
}

export interface Models {
  ground  : Vox[];
  forest  : Vox[];
  black   : Vox[];
  water   : Vox[];
  rock    : Vox[][];
  ramp    : Vox[];
  bridge  : Vox[];
  trees   : Vox[];
  stump   : Vox;
  straight: Vox;
  curve   : Vox;
  slope   : Vox;
  wood    : Vox[];
  ore     : Vox[];
  grass   : Vox[];

  // Visual extras (D11.11). Boulders by size: 0 big, 1 medium, 2 small.
  //
  groundDetail : Vox[];
  blackStrata  : Vox[];
  boulders     : Vox[][];
  crags        : Vox[];
  pebbles      : Vox[];
  flowers      : Vox[];
  leaves       : Vox[];
  gravel       : Vox[];
  bush         : Vox[];

  // Face pieces (D11.12).
  //
  vine         : Vox[];
  sideStone    : Vox[];
  grassFringe  : Vox[];

  // Carved black rock (D11.13): class maps of etqws3's blocks, and the
  // relief blocks for the eight tops (tools/carvevox.ts).
  //
  carved       : string[];
  carvedRelief : Vox[];

  // Brick grey rock (D11.14): the Techno Bricks body tile's class map,
  // and relief blocks by stage then variant (tools/brickvox.ts).
  //
  bricks       : string;
  rockTiles    : string[];
  rockCarve    : CarveOpts & { variants: number };
}

// View settings that change how the terrain is built; changing one
// rebuilds every chunk.
//
export const TERRAIN_VIEW_KEYS = new Set([
  "waterLevel", "ao", "aoStrength", "groundDetail", "groundPatches", "groundPatchStrength", "groundPatchScale",
  "groundDecor", "groundDecorDensity", "treeVariety", "treeFill", "treeScaleJitter", "treeTint", "treeSway",
  "rockBoulders", "boulderSpill", "boulderScale", "crags", "cragDensity", "cragHeight", "blackStrata",
  "designedTiles", "edgeLines", "faceDecor", "faceDecorDensity", "carvedBlack", "carvedRelief",
  "brickRock", "brickRelief", "groundTints", "groundTintCount", "groundTintStrength",
  "treeTints", "treeTintCount", "treeTintStrength", "blackTints", "blackTintCount", "blackTintStrength",
  "rockTints", "rockTintCount", "rockTintStrength", "rockPatterns", "rockPatternScale",
]);

// Ground tints (D11.15): colour multipliers sprinkled at random over
// ground cells, one per cell, so ground is not one flat colour when
// zoomed out. Mild on purpose: lighter, darker, warmer, cooler, drier,
// redder, greyer. The first entry is neutral.
//
export const GROUND_TINTS: [number, number, number][] = [
  [1.00, 1.00, 1.00], [1.05, 1.04, 1.02], [0.95, 0.95, 0.96], [1.04, 1.00, 0.95],
  [0.98, 0.99, 1.03], [1.03, 1.03, 0.94], [1.05, 0.98, 0.95], [0.97, 0.99, 0.95],
  [0.97, 0.96, 0.98], [1.02, 1.01, 1.04], [0.93, 0.92, 0.92], [1.06, 1.02, 0.97],
  [1.01, 0.97, 0.97], [0.96, 0.98, 0.98], [1.03, 1.02, 1.00], [0.99, 0.96, 0.93],
];

// Tree tints (D11.15): per tree, mild shifts of the greens: yellower,
// bluer, darker, lighter, olive. The first entry is neutral.
//
export const TREE_TINTS: [number, number, number][] = [
  [1.00, 1.00, 1.00], [1.08, 1.04, 0.92], [0.92, 0.99, 1.06], [0.91, 0.92, 0.91],
  [1.06, 1.07, 1.04], [1.09, 1.00, 0.90], [0.96, 1.04, 0.96], [1.03, 0.97, 1.00],
  [0.95, 0.95, 1.02], [1.04, 1.06, 0.94], [0.94, 1.00, 0.94], [1.07, 1.02, 1.00],
  [0.98, 1.05, 1.05], [1.02, 0.95, 0.94], [0.97, 1.02, 0.92], [1.05, 1.03, 1.06],
];

// Black rock tints (D11.15): per cell, mild shifts of the dark greys:
// warmer, bluer, darker, lighter, faintly purple or green.
//
export const BLACK_TINTS: [number, number, number][] = [
  [1.00, 1.00, 1.00], [1.05, 1.02, 0.97], [0.96, 0.98, 1.06], [0.92, 0.92, 0.93],
  [1.07, 1.07, 1.06], [1.03, 0.98, 1.05], [0.98, 1.03, 0.99], [1.04, 1.03, 1.00],
  [0.95, 0.96, 1.00], [1.02, 1.02, 1.07], [0.94, 0.93, 0.92], [1.06, 1.03, 1.02],
  [0.99, 0.97, 1.03], [1.01, 1.04, 1.03], [0.97, 0.95, 0.95], [1.03, 1.05, 1.07],
];

// Grey rock tints (D11.15): per cell, mild shifts of the light greys:
// warmer, cooler, darker, lighter, sandier, bluer.
//
export const ROCK_TINTS: [number, number, number][] = [
  [1.00, 1.00, 1.00], [1.05, 1.02, 0.97], [0.96, 0.98, 1.04], [0.93, 0.93, 0.93],
  [1.05, 1.05, 1.05], [1.04, 1.02, 0.93], [0.97, 0.99, 1.02], [1.02, 0.99, 0.97],
  [0.95, 0.95, 0.97], [1.01, 1.03, 1.05], [0.94, 0.93, 0.92], [1.06, 1.04, 1.00],
  [0.99, 0.97, 1.01], [1.00, 1.03, 1.00], [0.97, 0.95, 0.94], [1.03, 1.03, 1.06],
];

// One of the first `count` tints of a list, picked by a hash key and
// scaled by `strength` (0 is neutral).
//
export function pickTint(list: [number, number, number][], count: number, strength: number, key: number): [number, number, number] {
  const n = Math.max(1, Math.min(list.length, Math.round(count))), t = list[hash(key) % n];
  return [1 + (strength * (t[0] - 1)), 1 + (strength * (t[1] - 1)), 1 + (strength * (t[2] - 1))];
}

// Carved grey rock geometry by brick tiles, then by rockKey; kept for the
// session.
//
const ROCK_GEO = new WeakMap<string[], Map<string, THREE.BufferGeometry>>();

// Boulder models are built at half resolution and drawn at this scale.
//
const BOULDER_VOXEL = 2;

// A random number in [0, 1) from a cell index and a salt.
//
function rnd(i: number, salt: number): number {
  return ( hash((Math.imul(i, 7919) + Math.imul(salt, 104729)) | 0) / 4294967296 );
}

// Smooth value noise in [0, 1): hashed lattice values every `scale`
// cells, blended bilinearly with a smoothstep.
//
export function noise2(x: number, y: number, scale: number, salt: number): number {
  const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy),
        tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - (2 * tx)), sy = ty * ty * (3 - (2 * ty));
  const v = (a: number, b: number) => ( hash((((a * 73856093) ^ (b * 19349663)) + salt) | 0) / 4294967296 );
  return ( (v(ix, iy) * (1 - sx) * (1 - sy)) + (v(ix + 1, iy) * sx * (1 - sy)) +
           (v(ix, iy + 1) * (1 - sx) * sy) + (v(ix + 1, iy + 1) * sx * sy) );
}

// Blue-noise choice of tile look: each cell picks one of 4 variants and
// one of 4 quarter turns of its top, avoiding what nearby cells already
// picked (closer neighbours count more), ties broken by hash. Same
// variants then never clump and repeats spread out evenly.
//
function blueLooks(w: number, h: number): { look: Uint8Array, turn: Uint8Array } {
  const look = new Uint8Array(w * h), turn = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = 0, bs = Infinity;
      for (let v = 0; v < 4; v++) {
        for (let t = 0; t < 4; t++) {
          let sc = (hash((((x * 7919) + (y * 104729)) * 16) + (v * 4) + t) / 4294967296) * 0.05;
          for (let dy = -2; dy <= 0; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if ( (dy === 0) && (dx >= 0) ) { continue; }
              const nx = x + dx, ny = y + dy;
              if ( (nx < 0) || (nx >= w) || (ny < 0) ) { continue; }
              const j = (ny * w) + nx, wt = 1 / ((dx * dx) + (dy * dy));
              if (look[j] === v) { sc += wt; }
              if (turn[j] === t) { sc += 0.4 * wt; }
            }
          }
          if (sc < bs) { bs = sc; best = (v * 4) + t; }
        }
      }
      look[(y * w) + x] = best >> 2;
      turn[(y * w) + x] = best & 3;
    }
  }
  return { look, turn };
}

// Rotation about Y that turns model +X toward direction d (sim N, E, S, W).
//
export function yawFor(d: number): number {
  return Math.atan2(-DIRS[d][1], DIRS[d][0]);
}

// Rotation about Y (multiple of 90 degrees) that turns the curve piece,
// joining west and south, to join the directions in `conn`.
//
export function curveYaw(conn: number): number {
  for (let k = 0; k < 4; k++) {
    const th = (k * Math.PI) / 2;
    let got = 0;
    for (const d of [3, 2]) {
      const x = DIRS[d][0], z = DIRS[d][1],
            rx = Math.round((x * Math.cos(th)) + (z * Math.sin(th))),
            rz = Math.round((-x * Math.sin(th)) + (z * Math.cos(th)));
      got |= (1 << DIRS.findIndex(v => ( (v[0] === rx) && (v[1] === rz) )));
    }
    if (got === conn) { return th; }
  }
  return 0;
}

// Tree spots on a forest cell: a jittered 3 x 3 grid, in cell units.
//
function treeSpots(i: number): [number, number][] {
  const out = [] as [number, number][];
  for (let k = 0; k < 9; k++) {
    const r = hash((i * 9) + k), jx = (((r & 255) / 255) - 0.5) * 0.12, jz = ((((r >>> 8) & 255) / 255) - 0.5) * 0.12;
    out.push([((k % 3) + 0.5) / 3 + jx, (Math.floor(k / 3) + 0.5) / 3 + jz]);
  }
  return out;
}

export class Terrain {
  w       : World;
  m       : Models;
  group   : THREE.Group;
  atlas   : Atlas;
  mat     : THREE.MeshLambertMaterial;
  vmat    : THREE.MeshLambertMaterial;
  keys    : Map<Vox, number>;
  chunks  : THREE.Mesh[];
  dirty   : Set<number>;
  props   : THREE.Group;
  pchunks : THREE.Group[];
  geo     : Map<Vox, THREE.BufferGeometry>;
  look    : Uint8Array;
  turn    : Uint8Array;
  edges   : THREE.LineSegments[];
  edgeMat : THREE.LineBasicMaterial;
  waters  : THREE.Mesh[];
  wmat    : THREE.MeshLambertMaterial;
  tmat    : THREE.MeshLambertMaterial;
  time    : { value: number };
  waterVar : { value: number };
  sway    : { value: number };
  nearForest : Float32Array;
  nearRock   : Float32Array;
  sheet   : TileSheet;
  dtex    : THREE.DataTexture;
  dmat    : THREE.MeshLambertMaterial;
  dchunks : THREE.Mesh[];

  constructor(w: World, m: Models) {
    this.w = w;
    this.m = m;
    this.group = new THREE.Group();
    this.props = new THREE.Group();
    this.group.add(this.props);
    const blocks = [...m.ground, ...m.forest, ...m.black, ...m.water, ...m.rock.flat(), ...m.groundDetail, ...m.blackStrata];
    this.atlas = new Atlas(blocks);
    this.keys  = new Map(blocks.map((b, k) => [b, k]));
    this.mat   = new THREE.MeshLambertMaterial({ map: this.atlas.texture, vertexColors: true });
    this.vmat  = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.geo   = new Map();
    this.chunks = [];
    this.dirty = new Set();
    this.edges = [];
    this.pchunks = [];
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x1e140c, transparent: true, opacity: 0.6 });
    ({ look: this.look, turn: this.turn } = blueLooks(w.w, w.h));

    // Water: its own meshes, with a material whose surface bobs gently
    // and shimmers in light and dark bands drifting across the level.
    // The bob uses the position in level units (the mesh is not moved, so
    // this holds on the page and on the AR board), so neighbouring cells'
    // shared corners move together. With view.waterVariety (D11.17): a
    // slow swell whose strength wanders over the level, so some stretches
    // heave more than others; each cell a slightly different shade; and
    // now and then a faint ring spreading from a random point in a cell.
    //
    this.waters = [];
    this.time   = { value: 0 };
    this.waterVar = { value: 1 };
    this.wmat   = new THREE.MeshLambertMaterial({ map: this.atlas.texture, vertexColors: true });
    this.wmat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.time;
      sh.uniforms.uVar  = this.waterVar;
      sh.vertexShader = "uniform float uTime;\nuniform float uVar;\nvarying float vWave;\nvarying vec2 vLevel;\n" + sh.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\n" +
        "vec3 wpos = transformed;\n" +
        "vLevel = wpos.xz;\n" +
        "vWave = (sin((wpos.x * 2.1) + (uTime * 1.3)) * sin((wpos.z * 1.7) - (uTime * 1.1))) +\n" +
        "        (0.5 * sin(((wpos.x + wpos.z) * 3.3) - (uTime * 2.0)));\n" +
        "float swell = uVar * (0.5 + (0.5 * sin((wpos.x * 0.31) + (wpos.z * 0.23) + (uTime * 0.15)))) *\n" +
        "              sin((wpos.x * 0.9) - (wpos.z * 1.3) + (uTime * 0.7));\n" +
        "if (normal.y > 0.5) { transformed.y += (0.02 * vWave) + (0.025 * swell); }\n");
      sh.fragmentShader = "uniform float uTime;\nuniform float uVar;\nvarying float vWave;\nvarying vec2 vLevel;\n" +
        "float wHash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }\n" +
        sh.fragmentShader.replace("#include <map_fragment>",
        "#include <map_fragment>\n" +
        "vec2 cell = floor(vLevel), inCell = vLevel - cell;\n" +
        "float h1 = wHash(cell), h2 = wHash(cell + 17.0), h3 = wHash(cell + 41.0);\n" +
        "vec3 shade = vec3(1.0 + (0.05 * (h1 - 0.5)), 1.0 + (0.06 * (h2 - 0.5)), 1.0 + (0.04 * (h1 - 0.5)));\n" +
        "float period = 5.0 + (5.0 * h3), tau = fract((uTime + (h1 * 37.0)) / period) * period;\n" +
        "vec2 src = vec2(0.35, 0.35) + (0.3 * vec2(h2, h3));\n" +
        "float r = length(inCell - src), dr = (r - (0.25 * tau)) * 18.0, ring = exp(-(dr * dr)) * max(0.0, 1.0 - (tau / 1.2));\n" +
        "diffuseColor.rgb *= (1.0 + (0.1 * vWave)) * mix(vec3(1.0), shade, uVar) * (1.0 + (0.12 * uVar * ring));\n");
    };

    // Trees and bushes: a material whose tops sway in the wind, each
    // instance on its own phase (view.treeSway). Shadows do not sway.
    //
    this.sway = { value: 0 };
    this.tmat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.tmat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.time;
      sh.uniforms.uSway = this.sway;
      sh.vertexShader = "uniform float uTime;\nuniform float uSway;\n" + sh.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\n" +
        "#ifdef USE_INSTANCING\n" +
        "vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);\n" +
        "#else\n" +
        "vec3 ip = vec3(0.0);\n" +
        "#endif\n" +
        "float bend = uSway * max(0.0, transformed.y) * max(0.0, transformed.y);\n" +
        "transformed.x += bend * sin((uTime * 1.6) + (ip.x * 0.7) + (ip.z * 1.1));\n" +
        "transformed.z += 0.6 * bend * cos((uTime * 1.3) + (ip.x * 0.9) - (ip.z * 0.5));\n");
    };

    // Designed tiles (view.designedTiles): one sheet of pixel-art faces.
    //
    this.sheet = tileSheet();
    this.dtex  = new THREE.DataTexture(this.sheet.data, this.sheet.w, this.sheet.h, THREE.RGBAFormat);
    this.dmat  = new THREE.MeshLambertMaterial({ map: this.dtex, vertexColors: true });
    this.makeSheet();
    this.dchunks = [];

    this.nearForest = new Float32Array(w.w * w.h);
    this.nearRock   = new Float32Array(w.w * w.h);
    for (let c = 0; c < Math.ceil(w.w / CHUNK); c++) { this.dirty.add(c); }
  }

  // (Re)draw the designed sheet: carved black rock or not
  // (view.carvedBlack), brick grey rock or not (view.brickRock).
  //
  makeSheet(): void {
    this.sheet = tileSheet( ( (CONFIG.view.carvedBlack && this.m.carved.length) ? this.m.carved : null ),
                            ( (CONFIG.view.brickRock && this.m.bricks) ? this.m.bricks : null ) );
    const t = new THREE.DataTexture(this.sheet.data, this.sheet.w, this.sheet.h, THREE.RGBAFormat);
    t.magFilter  = THREE.NearestFilter;
    t.minFilter  = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    this.dtex.dispose();
    this.dtex = t;
    this.dmat.map = t;
    this.dmat.needsUpdate = true;
  }

  // Share of trees and of grey rock among the cells within two of each
  // cell; drives ground colour and details near forests and rock.
  //
  // Only columns x0 to x1 (default all): a change reaches 2 cells, and
  // chunks read their cells and one beyond, so columns 3 either side of
  // the changed chunks are enough.
  //
  measureNear(x0 = 0, x1 = this.w.w - 1): void {
    const w = this.w;
    for (let y = 0; y < w.h; y++) {
      for (let x = Math.max(0, x0); x <= Math.min(w.w - 1, x1); x++) {
        let f = 0, r = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (!w.inside(x + dx, y + dy)) { continue; }
            const c = w.type(w.idx(x + dx, y + dy));
            n++;
            if (c === Cell.TREE) { f++; }
            if (c === Cell.ROCK) { r++; }
          }
        }
        this.nearForest[w.idx(x, y)] = f / n;
        this.nearRock[w.idx(x, y)]   = r / n;
      }
    }
  }

  vgeo(m: Vox): THREE.BufferGeometry {
    let g = this.geo.get(m);
    if (!g) { g = voxGeometry(m, true); this.geo.set(m, g); }
    return g;
  }

  // Which brick unit grey rock cell i uses (view.rockPatterns of them):
  // the same over regions about rockPatternScale cells across, with
  // ragged edges, so patches of rock share a pattern and neighbouring
  // patches differ; 0 picks per cell at random.
  //
  rockUnit(i: number): number {
    const V = CONFIG.view, n = Math.max(1, Math.min(this.m.rockTiles.length, Math.round(V.rockPatterns))), [x, y] = this.w.xy(i);
    if (V.rockPatternScale <= 0) { return ( hash(i + 311) % n ); }
    const S = V.rockPatternScale, jx = (noise2(x, y, S, 5) - 0.5) * S, jy = (noise2(x, y, S, 9) - 0.5) * S,
          gx = Math.floor((x + jx) / S), gy = Math.floor((y + jy) / S);
    return ( hash((Math.imul(gx, 7919) + Math.imul(gy, 104729) + 13) | 0) % n );
  }

  // Whether grey rock cell i should be a carved block (view.brickRelief)
  // instead of a textured box.
  //
  carvedRock(i: number): boolean {
    const V = CONFIG.view;
    return ( (this.w.type(i) === Cell.ROCK) && !V.rockBoulders && V.designedTiles && V.brickRock && V.brickRelief &&
             (this.m.rockTiles.length > 0) );
  }

  // Grey rock cell i's carved block: its pattern, mining stage, variant
  // and exposed sides (bit d where the neighbour in direction d is
  // lower than the rock's top), as a cache key.
  //
  rockKey(i: number): string {
    const w = this.w, y1 = topY(w.z(i)) + 0.5;
    let ex = 0;
    for (let d = 0; d < 4; d++) {
      const j = w.step(i, d), nb = ( (j < 0) ? -1 : ( this.colTop(j) + ( (w.type(j) === Cell.ROCK) ? 0.5 : 0 ) ) );
      if (nb < (y1 - 0.01)) { ex |= (1 << d); }
    }
    return this.rockUnit(i) + "," + Math.min(3, w.hits[i]) + "," + (hash(i + 5) % Math.max(1, this.m.rockCarve.variants)) + "," + ex;
  }

  // Carving takes milliseconds per block, so update() carves at most
  // `carveMs` milliseconds' worth per call (Infinity: all at once); a
  // cell whose block is not carved yet draws as a textured box, and its
  // chunk is rebuilt on a later call. Carved blocks are kept for the
  // session, across levels.
  //
  carveMs = Infinity;
  private carveLeft = Infinity;
  private carvePending = new Set<number>();

  // Cell i's carved block geometry, carving it now if the budget allows;
  // null when it is not carved yet (or i is not carved rock).
  //
  rockReady(i: number): THREE.BufferGeometry | null {
    if (!this.carvedRock(i)) { return null; }
    const key = this.rockKey(i);
    let byKey = ROCK_GEO.get(this.m.rockTiles);
    if (!byKey) { byKey = new Map(); ROCK_GEO.set(this.m.rockTiles, byKey); }
    let g = byKey.get(key);
    if (g) { return g; }
    if (this.carveLeft <= 0) { this.carvePending.add(Math.floor(this.w.xy(i)[0] / CHUNK)); return null; }
    const t0 = performance.now(), [u, s, v, ex] = key.split(",").map(Number),
          pal: [number, number, number][] = [[0, 0, 0], ...[...BRICK_PALETTE, BRICK_CRACK].map(h =>
            [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as [number, number, number])];
    g = voxGeometry({ sx: BLOCK_XY, sy: BLOCK_XY, sz: BLOCK_Z, v: brickBlock(this.m.rockTiles[u], s, v, ex, this.m.rockCarve), pal }, true);
    byKey.set(key, g);
    this.carveLeft -= (performance.now() - t0);
    return g;
  }

  // Grey rock cell i's tint (view.rockTints), or null.
  //
  rockTint(i: number): [number, number, number] | null {
    const V = CONFIG.view;
    return ( V.rockTints ? pickTint(ROCK_TINTS, V.rockTintCount, V.rockTintStrength, i + 277) : null );
  }

  // Tree cell i's tint (view.treeTints), as its first tree gets it, or
  // null.
  //
  treeTint(i: number): [number, number, number] | null {
    const V = CONFIG.view;
    return ( V.treeTints ? pickTint(TREE_TINTS, V.treeTintCount, V.treeTintStrength, (i * 16) + 333) : null );
  }

  // Mark the chunk holding cell i (and its neighbours' chunks, whose
  // side faces may change) for rebuilding.
  //
  touch(i: number): void {
    const [x] = this.w.xy(i);
    for (const xx of [x - 1, x, x + 1]) {
      if ( (xx >= 0) && (xx < this.w.w) ) { this.dirty.add(Math.floor(xx / CHUNK)); }
    }
  }

  // Block model for layer k of column i.
  //
  block(i: number, k: number, h: number): Vox {
    const c = this.w.type(i), v = this.look[i], V = CONFIG.view;
    if (c === Cell.BLACKROCK) { return ( V.blackStrata ? this.m.blackStrata : this.m.black )[v]; }
    if (k < h) { return this.m.ground[(v + k) % 4]; }
    if (c === Cell.TREE) { return this.m.forest[v]; }
    if ( (c === Cell.WATER) && !this.w.bridge[i] ) { return this.m.water[v % 2]; }
    return ( V.groundDetail ? this.m.groundDetail : this.m.ground )[v];
  }

  // Height of the column under cell i (the ground below a bridge).
  //
  colH(i: number): number { return ( this.w.bridge[i] ? this.w.under[i] : this.w.z(i) ); }

  // Top of column i as drawn: water sits below the top of its block, at
  // view.waterLevel of the block's height.
  //
  colTop(i: number): number {
    const h = this.colH(i);
    return ( (this.w.type(i) === Cell.WATER) ? ((h * 0.5) + (0.5 * CONFIG.view.waterLevel)) : topY(h) );
  }

  // Animation time for the water, in seconds.
  //
  setTime(t: number): void {
    this.time.value = t;
    this.waterVar.value = ( CONFIG.view.waterVariety ? 1 : 0 );
    this.sway.value = ( CONFIG.view.treeSway ? CONFIG.view.treeSwayAmount : 0 );
  }

  // Rebuild every chunk, e.g. after view.waterLevel changes.
  //
  rebuildAll(): void {
    this.makeSheet();
    for (let c = 0; c < Math.ceil(this.w.w / CHUNK); c++) { this.dirty.add(c); }
  }

  // Rebuild changed chunks: those in the window (and one either side)
  // every call, nearest its middle first; others, hidden anyway, only
  // while the call has spent under BUILD_MS, so a run of many levels is
  // built over several frames. A chunk waiting for rock to be carved is
  // rebuilt again only once it is in the window (it would otherwise be
  // rebuilt every frame, carved or not).
  //
  update(): void {
    this.carveLeft = this.carveMs;
    const t0 = performance.now(), near = (c: number) => ( (c >= (this.winC0 - 1)) && (c <= (this.winC1 + 1)) ),
          mid = ( Number.isFinite(this.winC1) ? ((this.winC0 + this.winC1) / 2) : 0 );
    for (const c of [...this.carvePending]) {
      if (near(c)) { this.dirty.add(c); this.carvePending.delete(c); }
    }
    const order = [...this.dirty].sort((a, b) => ( Math.abs(a - mid) - Math.abs(b - mid) ));
    for (const c of order) {
      if ( !near(c) && ((performance.now() - t0) > BUILD_MS) ) { break; }
      this.dirty.delete(c);
      this.measureNear((c * CHUNK) - 3, ((c + 1) * CHUNK) + 2);
      this.buildChunk(c);
      this.buildProps(c);
    }
  }

  // The window's chunks (setWindow), first and last; before any window,
  // all of them (update() then builds every chunk at once).
  //
  private winC0 = 0;
  private winC1 = Infinity;

  // Show only chunks overlapping x in [x0, x1]; hidden chunks are skipped
  // by both the main and the shadow pass.
  //
  setWindow(x0: number, x1: number): void {
    this.winC0 = Math.floor(x0 / CHUNK);
    this.winC1 = Math.floor(x1 / CHUNK);
    for (let c = 0; c < this.chunks.length; c++) {
      const on = ( (((c + 1) * CHUNK) >= x0) && ((c * CHUNK) <= x1) );
      if (this.chunks[c])  { this.chunks[c].visible = on; }
      if (this.edges[c])   { this.edges[c].visible = on; }
      if (this.pchunks[c]) { this.pchunks[c].visible = on; }
      if (this.waters[c])  { this.waters[c].visible = on; }
      if (this.dchunks[c]) { this.dchunks[c].visible = on; }
    }
  }

  buildChunk(c: number): void {
    const w = this.w, main = new BoxBuilder(), wb = new BoxBuilder(), db = new BoxBuilder(), A = this.atlas;
    let b = main;
    // Texture corners follow the atlas layout: tops by (x, y), sides by
    // (position along the face, height); `flip` when the quad's first
    // corner is at the far end of the face.
    //
    // Tops are turned by the cell's blue-noise quarter turn. Colour:
    // a broad, gentle brightness wash over the level, and sides darker
    // than tops so ledges read at any angle.
    //
    // With view.groundPatches, tops of ground, forest, rock and station
    // cells take their colour per corner from smooth noise over the level
    // instead (light and dark, warm and cool), greener near forests;
    // corners are shared by neighbouring cells, so patches have no seams.
    // With view.ao, top corners darken where higher columns stand beside
    // them (the usual voxel corner shading).
    //
    const V = CONFIG.view;
    let turn = 0, tint: [number, number, number] = [1, 1, 1], patchy = false, cell = 0;
    const solidTop = (j: number) => ( this.colTop(j) + ( (w.type(j) === Cell.ROCK) ? 0.5 : 0 ) );
    const occ = (x: number, y: number, y1: number) => ( ( w.inside(x, y) && (solidTop(w.idx(x, y)) > (y1 + 0.01)) ) ? 1 : 0 );
    const nearF = (vx: number, vz: number) => {
      let f = 0, n = 0;
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        if (w.inside(vx + dx, vz + dz)) { f += this.nearForest[w.idx(vx + dx, vz + dz)]; n++; }
      }
      return ( n ? (f / n) : 0 );
    };
    const corner = (vx: number, vz: number, y1: number): number[] => {
      let col = tint as number[];
      if ( patchy && V.groundPatches ) {
        const st = V.groundPatchStrength, S = Math.max(1, V.groundPatchScale),
              a = noise2(vx, vz, S, 7) - 0.5, bw = noise2(vx, vz, S * 0.6, 31) - 0.5, f = nearF(vx, vz) * 2;
        col = [1 + (st * ((1.2 * a) + (0.6 * bw) - (0.9 * f))), 1 + (st * ((1.0 * a) + (0.2 * bw) + (0.5 * f))),
               1 + (st * ((0.8 * a) - (0.4 * bw) - (0.5 * f)))];
      }
      if (!V.ao) { return col; }
      const [cx, cy] = w.xy(cell), sx = ( (vx > cx) ? 1 : -1 ), sz = ( (vz > cy) ? 1 : -1 ),
            s1 = occ(cx + sx, cy, y1), s2 = occ(cx, cy + sz, y1), cr = occ(cx + sx, cy + sz, y1),
            lv = ( (s1 && s2) ? 3 : (s1 + s2 + cr) ), k = 1 - ((V.aoStrength * lv) / 3);
      return [col[0] * k, col[1] * k, col[2] * k];
    };
    // Designed tiles: the material, variant, and whether the block is a
    // column's top block, for the box being drawn (null: use the voxel
    // atlas); `dmask` is the top's rim edges.
    //
    let dk: Mat | null = null, dvar = 0, dupper = false, dmask = 0;
    const face = (vx: Vox, part: "top" | number, p: number[][], n: number[], flip = false) => {
      const [u0, v0, u1, v1] = ( dk ? ( (part === "top") ? this.sheet.top(dk, dvar, dmask) : this.sheet.side(dk, dvar, dupper) ) :
                                 A.uv(this.keys.get(vx)!, part) );
      let t: [number, number][] = ( (part === "top") ? [[u0, v0], [u0, v1], [u1, v1], [u1, v0]] :
                                  ( flip ? [[u1, v0], [u0, v0], [u0, v1], [u1, v1]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] ) );
      if (part === "top") {
        if (!dk) { t = [...t.slice(turn), ...t.slice(0, turn)]; }
        const cs = p.map(q => corner(q[0], q[2], q[1])), lum = (c: number[]) => (c[0] + c[1] + c[2]);
        b.quad(p, n, t, cs, ( (lum(cs[0]) + lum(cs[2])) < (lum(cs[1]) + lum(cs[3])) ));
        return;
      }
      const sk = ( dk ? 0.8 : 0.72 );
      b.quad(p, n, t, [tint[0] * sk, tint[1] * sk, tint[2] * sk]);
    };
    const lines = [] as number[];

    // A block spanning [y0, y1] on cell (x, z), with its top if `top`,
    // and the sides not covered by a neighbour column at least `cover`
    // high.
    //
    const box = (vx: Vox, x: number, z: number, y0: number, y1: number, top: boolean, cover: (d: number) => number) => {
      dmask = 0;
      for (let d = 0; d < 4; d++) { if (cover(d) < (y1 - 0.01)) { dmask |= (1 << d); } }
      if (top) { face(vx, "top", [[x, y1, z], [x, y1, z + 1], [x + 1, y1, z + 1], [x + 1, y1, z]], [0, 1, 0]); }
      if (cover(1) < y1) { face(vx, 0, [[x + 1, y0, z + 1], [x + 1, y0, z], [x + 1, y1, z], [x + 1, y1, z + 1]], [1, 0, 0], true); }
      if (cover(3) < y1) { face(vx, 1, [[x, y0, z], [x, y0, z + 1], [x, y1, z + 1], [x, y1, z]], [-1, 0, 0]); }
      if (cover(2) < y1) { face(vx, 2, [[x, y0, z + 1], [x + 1, y0, z + 1], [x + 1, y1, z + 1], [x, y1, z + 1]], [0, 0, 1]); }
      if (cover(0) < y1) { face(vx, 3, [[x + 1, y0, z], [x, y0, z], [x, y1, z], [x + 1, y1, z]], [0, 0, -1], true); }

      // A dark line along the rim of every exposed top edge.
      //
      if ( top && V.edgeLines ) {
        const e = y1 + 0.003;
        if (cover(1) < y1) { lines.push(x + 1, e, z, x + 1, e, z + 1); }
        if (cover(3) < y1) { lines.push(x, e, z, x, e, z + 1); }
        if (cover(2) < y1) { lines.push(x, e, z + 1, x + 1, e, z + 1); }
        if (cover(0) < y1) { lines.push(x, e, z, x + 1, e, z); }
      }
    };

    for (let x = c * CHUNK; x < Math.min(w.w, (c + 1) * CHUNK); x++) {
      for (let y = 0; y < w.h; y++) {
        const i = w.idx(x, y), h = this.colH(i), n = noise2(x, y, 7, 11), g = noise2(x, y, 13, 29);
        turn = this.turn[i];
        cell = i;
        tint = [0.86 + (0.2 * n), 0.88 + (0.18 * n) + (0.05 * g), 0.86 + (0.16 * n)];
        const ct = w.type(i);

        // Ground tints (view.groundTints): one of the first
        // groundTintCount tints, picked at random per cell, scaled by
        // groundTintStrength.
        //
        // Black rock tints (view.blackTints) the same way, per column.
        //
        const ctint = ( (V.groundTints && (ct === Cell.GROUND)) ? pickTint(GROUND_TINTS, V.groundTintCount, V.groundTintStrength, i + 77) :
                      ( (V.blackTints && (ct === Cell.BLACKROCK)) ? pickTint(BLACK_TINTS, V.blackTintCount, V.blackTintStrength, i + 177) : null ) );
        if (ctint) { tint = [tint[0] * ctint[0], tint[1] * ctint[1], tint[2] * ctint[2]]; }
        patchy = ( (ct === Cell.GROUND) || (ct === Cell.TREE) || (ct === Cell.ROCK) || (ct === Cell.STATION) );
        const cover = (d: number) => {
          const j = w.step(i, d);
          return ( (j < 0) ? -1 : this.colTop(j) );
        };
        const wet = (w.type(i) === Cell.WATER), des = V.designedTiles;

        // Designed variant: blue-noise look plus one hashed bit gives 0 to
        // 7; the special (7) is kept for one cell in three that draw it.
        //
        dvar = (this.look[i] + ( ((hash(i + 5) & 1) === 1) ? 4 : 0 )) % 8;
        if ( (dvar === 7) && ((hash(i + 9) % 3) !== 0) ) { dvar = 0; }
        for (let k = 0; k <= h; k++) {
          if ( wet && (k === h) ) {
            dk = null;
            b = wb;
            box(this.m.water[this.look[i] % 2], x, y, k * 0.5, this.colTop(i), true, cover);
            b = main;
          }
          else {
            if (des) {
              dk = ( (ct === Cell.BLACKROCK) ? "black" : ( ( (k === h) && (ct === Cell.TREE) ) ? "forest" : "ground" ) );
              dupper = (k === h);
              b = db;
            }
            box(this.block(i, k, h), x, y, k * 0.5, (k + 1) * 0.5, (k === h), cover);
            b = main;
            dk = null;
          }
        }
        patchy = false;
        if ( (w.type(i) === Cell.ROCK) && !V.rockBoulders && !this.rockReady(i) ) {
          const st = Math.min(3, w.hits[i]), rv = this.m.rock[hash(i) % 4];
          const rcover = (d: number) => {
            const j = w.step(i, d);
            if (j < 0) { return -1; }
            return ( ( (w.type(j) === Cell.ROCK) && (this.colH(j) === h) ) ? (topY(h) + 0.5) : this.colTop(j) );
          };
          const rt = this.rockTint(i);
          if (rt) { tint = [tint[0] * rt[0], tint[1] * rt[1], tint[2] * rt[2]]; }
          if (des) { dk = ("rock" + st) as Mat; dupper = true; b = db; }
          box(rv[st] ?? rv[0], x, y, topY(h), topY(h) + 0.5, true, rcover);
          b = main;
          dk = null;
        }
      }
    }
    const oldW = this.waters[c];
    if (oldW) { this.group.remove(oldW); oldW.geometry.dispose(); }
    const water = new THREE.Mesh(wb.geometry(), this.wmat);
    water.receiveShadow = true;
    this.waters[c] = water;
    this.group.add(water);

    const oldD = this.dchunks[c];
    if (oldD) { this.group.remove(oldD); oldD.geometry.dispose(); }
    const dmesh = new THREE.Mesh(db.geometry(), this.dmat);
    dmesh.castShadow = true;
    dmesh.receiveShadow = true;
    this.dchunks[c] = dmesh;
    this.group.add(dmesh);

    const g = main.geometry();
    const old = this.chunks[c];
    if (old) { this.group.remove(old); old.geometry.dispose(); }
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.chunks[c] = mesh;
    this.group.add(mesh);

    const oldE = this.edges[c];
    if (oldE) { this.group.remove(oldE); oldE.geometry.dispose(); }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    this.edges[c] = new THREE.LineSegments(eg, this.edgeMat);
    this.group.add(this.edges[c]);
  }

  // Rebuild every chunk's props, e.g. after view.itemSize changes.
  //
  rebuildProps(): void {
    for (let c = 0; c < Math.ceil(this.w.w / CHUNK); c++) { this.dirty.add(c); }
  }

  // Trees, ramps, bridges, track, stacks and grass of chunk ch, as
  // instanced voxel meshes.
  //
  buildProps(ch: number): void {
    let grp = this.pchunks[ch];
    if (!grp) { grp = new THREE.Group(); this.pchunks[ch] = grp; this.props.add(grp); }
    for (const o of [...grp.children]) {
      grp.remove(o);
      if (o instanceof THREE.InstancedMesh) { o.dispose(); }
      else if ( (o instanceof THREE.Mesh) && o.userData.own ) { o.geometry.dispose(); }
    }
    const rockParts = [] as { g: THREE.BufferGeometry, x: number, y: number, z: number, t: [number, number, number] }[];
    const w = this.w, V = CONFIG.view, place = new Map<Vox, { mats: THREE.Matrix4[], cols: (THREE.Color | null)[] }>();
    const put = (m: Vox, x: number, y: number, z: number, yaw = 0, s: number | [number, number, number] = 1, col: THREE.Color | null = null) => {
      const sv = ( (typeof s === "number") ? new THREE.Vector3(s, s, s) : new THREE.Vector3(s[0], s[1], s[2]) );
      const mt = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
                   new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), sv);
      let a = place.get(m);
      if (!a) { a = { mats: [], cols: [] }; place.set(m, a); }
      a.mats.push(mt);
      a.cols.push(col);
    };
    const hpb = Math.max(1, CONFIG.rules.hitsPerBlock);

    const cells = [] as number[];
    for (let x = ch * CHUNK; x < Math.min(w.w, (ch + 1) * CHUNK); x++) {
      for (let y = 0; y < w.h; y++) { cells.push(w.idx(x, y)); }
    }
    for (const i of cells) {
      const [x, y] = w.xy(i), c = w.type(i), h = w.z(i), cx = x + 0.5, cz = y + 0.5;
      // Tree tints (view.treeTints): one per tree.
      //
      const treeTint = (k: number): THREE.Color | null => {
        if (!V.treeTints) { return null; }
        const t = pickTint(TREE_TINTS, V.treeTintCount, V.treeTintStrength, (i * 16) + k + 333);
        return new THREE.Color(t[0], t[1], t[2]);
      };
      if ( (c === Cell.TREE) && !V.treeVariety ) {
        const keep = Math.max(0, 9 - (3 * w.hits[i]));
        treeSpots(i).forEach(([sx, sz], k) => {
          if (k < keep) { put(this.m.trees[(hash(i) + k) % this.m.trees.length], x + sx, topY(h), y + sz, (hash(i + k) % 4) * (Math.PI / 2), 1, treeTint(k)); }
          else          { put(this.m.stump, x + sx, topY(h), y + sz, (hash(i + k) % 4) * (Math.PI / 2)); }
        });
      }

      // Tree variety (view.treeVariety): about treeFill of the nine spots
      // hold a tree, each with its own size, turn and colour; some empty
      // spots hold a bush. Chopping turns trees to stumps in step with the
      // hits.
      //
      if ( (c === Cell.TREE) && V.treeVariety ) {
        const spots = treeSpots(i).map(([sx, sz], k) => [sx + ((rnd(i, 40 + k) - 0.5) * 0.12), sz + ((rnd(i, 50 + k) - 0.5) * 0.12)]),
              filled = spots.filter((_, k) => ( rnd(i, 60 + k) < V.treeFill )),
              trees  = ( (filled.length >= 2) ? filled : spots.slice(0, 2) ),
              keep   = Math.ceil(trees.length * Math.max(0, 1 - (w.hits[i] / hpb)));
        trees.forEach(([sx, sz], k) => {
          const u = rnd(i, 70 + k), tn = V.treeTint * 2,
                a = (rnd(i, 80 + k) - 0.5) * tn, bw = (rnd(i, 90 + k) - 0.5) * tn;
          if (k < keep) {
            const vc = new THREE.Color(1 + a - (0.5 * bw), 1 + a + (0.3 * bw), 1 + a - bw), tt = treeTint(k);
            if (tt) { vc.multiply(tt); }
            put(this.m.trees[(hash(i) + k) % this.m.trees.length], x + sx, topY(h), y + sz, u * Math.PI * 2,
                1 + (V.treeScaleJitter * ((2 * rnd(i, 100 + k)) - 1)), vc);
          }
          else { put(this.m.stump, x + sx, topY(h), y + sz, u * Math.PI * 2); }
        });
        spots.forEach(([sx, sz], k) => {
          if ( trees.includes(spots[k]) || (rnd(i, 110 + k) > 0.3) ) { return; }
          put(this.m.bush[hash(i + k) % this.m.bush.length], x + sx, topY(h), y + sz, rnd(i, 120 + k) * Math.PI * 2, 0.8 + (0.4 * rnd(i, 130 + k)));
        });
      }

      // Grey rock as boulders (view.rockBoulders): a big one near the
      // middle, two or three smaller ones around it, reaching up to
      // boulderSpill past the cell's edge. Hits remove the small ones
      // first and shrink the rest.
      //
      if ( (c === Cell.ROCK) && V.rockBoulders ) {
        const boxed = [0, 1, 2, 3].every(d => { const j = w.step(i, d); return ( (j >= 0) && (w.type(j) === Cell.ROCK) ); }),
              st = Math.min(hpb - 1, w.hits[i]), sp = V.boulderSpill, n = ( boxed ? 2 : (3 + Math.floor(rnd(i, 200) * 2)) ),
              keep = Math.max(1, n - st), shrink = 1 - (0.1 * st), a0 = rnd(i, 201) * Math.PI * 2;
        for (let k = 0; k < keep; k++) {
          const size = ( (k === 0) ? 0 : ( (k <= 2) ? 1 : 2 ) ), dist = ( (k === 0) ? (0.1 * rnd(i, 210)) : (0.24 + sp) ) + ((rnd(i, 220 + k) - 0.5) * sp),
                ang = a0 + ((k * Math.PI * 2) / Math.max(1, n - 1)) + ((rnd(i, 230 + k) - 0.5) * 0.8),
                sc = BOULDER_VOXEL * V.boulderScale * shrink * (0.9 + (0.25 * rnd(i, 240 + k)));
          put(this.m.boulders[size][hash(i + k) % this.m.boulders[size].length], cx + (Math.cos(ang) * dist), topY(h),
              cz + (Math.sin(ang) * dist), rnd(i, 250 + k) * Math.PI * 2, sc);
        }
      }

      // Crags on black rock (view.crags): with chance cragDensity per cell,
      // one or two spires, taller where the cell is surrounded by rock at
      // least as high; their height scaled by cragHeight.
      //
      if ( (c === Cell.BLACKROCK) && V.crags && (rnd(i, 300) < V.cragDensity) ) {
        const inner = [0, 1, 2, 3].every(d => { const j = w.step(i, d); return ( (j >= 0) && (w.type(j) === Cell.BLACKROCK) && (w.z(j) >= h) ); }),
              n = 1 + ( (rnd(i, 301) < 0.4) ? 1 : 0 );
        for (let k = 0; k < n; k++) {
          const v = ( inner ? 3 : 0 ) + Math.floor(rnd(i, 310 + k) * 3), s = 0.9 + (0.3 * rnd(i, 320 + k));
          put(this.m.crags[v], cx + ((rnd(i, 330 + k) - 0.5) * 0.5), topY(h) - 0.02, cz + ((rnd(i, 340 + k) - 0.5) * 0.5),
              rnd(i, 350 + k) * Math.PI * 2, [s, s * V.cragHeight, s]);
        }
      }
      if (isRamp(c)) { put(this.m.ramp[hash(i) % 4], cx, topY(h), cz, yawFor(w.g.dir[i])); }
      if (w.bridge[i]) { put(this.m.bridge[hash(i) % 4], cx, topY(h) - 0.5, cz); }

      if (w.track[i]) {
        const cn = w.conn[i], ty = topY(h);
        if (isRamp(c)) { put(this.m.slope, cx, ty, cz, yawFor(w.g.dir[i])); }
        else {
          const ns = ( (cn === 0b0101) || (cn === 0b0001) || (cn === 0b0100) ),
                ew = ( (cn === 0b1010) || (cn === 0b0010) || (cn === 0b1000) || (cn === 0) );
          if      (ns) { put(this.m.straight, cx, ty, cz, Math.PI / 2); }
          else if (ew) { put(this.m.straight, cx, ty, cz, 0); }
          else         { put(this.m.curve, cx, ty, cz, curveYaw(cn)); }
        }
      }

      // Stacks keep the item size: wood and ore as columns of cubes
      // view.itemSize on a side (four columns around the cell's centre,
      // filled in turn), track as a pile of pieces at TRACK_PILE of full
      // size. Every item is drawn, however tall the stack grows. Wagons
      // on the ground are drawn by the page (they are whole models).
      //
      if (w.stack[i]) {
        const kind = w.stack[i], base = topY(h);
        if (kind === Item.TRACK) {
          const n = w.count[i];
          for (let k = 0; k < n; k++) { put(this.m.straight, cx, base + (k * 0.07), cz, ( ((k % 2) === 0) ? 0 : 0.12 ), TRACK_PILE); }
        }
        else if ( (kind === Item.WOOD) || (kind === Item.ORE) ) {
          const set = ( (kind === Item.WOOD) ? this.m.wood : this.m.ore ), n = w.count[i],
                side = CONFIG.view.itemSize, d = 0.55 * side;
          for (let k = 0; k < n; k++) {
            const col = k % 4, lay = Math.floor(k / 4);
            put(set[(hash(i) + k) % set.length], cx + ( ((col % 2) === 0) ? -d : d ), base + (lay * side),
                cz + ( (col < 2) ? -d : d ), 0, itemScale());
          }
        }
      }

      // Carved relief (view.carvedRelief): on a carved black rock top, its
      // block raised as a heightfield by class.
      //
      if ( (c === Cell.BLACKROCK) && V.designedTiles && V.carvedBlack && V.carvedRelief && this.m.carvedRelief.length ) {
        let v = (this.look[i] + ( ((hash(i + 5) & 1) === 1) ? 4 : 0 )) % 8;
        if ( (v === 7) && ((hash(i + 9) % 3) !== 0) ) { v = 0; }
        const bt = ( V.blackTints ? pickTint(BLACK_TINTS, V.blackTintCount, V.blackTintStrength, i + 177) : null );
        put(this.m.carvedRelief[v], cx, topY(h), cz, 0, 1, ( bt ? new THREE.Color(bt[0], bt[1], bt[2]) : null ));
      }

      // Brick relief (view.brickRelief): grey rock as one carved block per
      // cell, for its pattern (rockUnit), mining stage, variant and
      // exposed sides, tinted as the cell; the chunk's blocks are merged
      // into one mesh. The stage follows the hits, so mining cracks it.
      //
      const rg = this.rockReady(i);
      if (rg) { rockParts.push({ g: rg, x: cx, y: topY(h), z: cz, t: this.rockTint(i) ?? [1, 1, 1] }); }

      // Face pieces (view.faceDecor): on the exposed part of each side of
      // a column's top block, now and then a vine (black rock), a grass
      // fringe (forest) or a stone (dirt). Each sits on the face, along it
      // at a random spot, half sunk in the wall.
      //
      if ( V.faceDecor && !isRamp(c) && (c !== Cell.WATER) && !w.bridge[i] ) {
        const top = this.colTop(i), dn = V.faceDecorDensity;
        for (let d = 0; d < 4; d++) {
          const j = w.step(i, d), below = ( (j < 0) ? -1 : this.colTop(j) + ( (w.type(j) === Cell.ROCK) ? 0.5 : 0 ) );
          if (below > (top - 0.3)) { continue; }
          const [set, p, hang] = ( (c === Cell.BLACKROCK) ? [this.m.vine, 0.14, true] :
                                 ( (c === Cell.TREE) ? [this.m.grassFringe, 0.45, true] : [this.m.sideStone, 0.12, false] ) ) as [Vox[], number, boolean];
          if (rnd(i, 500 + d) >= (p * dn)) { continue; }
          const m = set[hash(i + d) % set.length], along = (rnd(i, 510 + d) - 0.5) * 0.55,
                ox = DIRS[d][0], oz = DIRS[d][1], tx = -oz, tz = ox,
                hgt = m.sz / 32, y0 = ( hang ? (top - hgt + 0.01) : (Math.max(below, top - 0.5) + 0.05 + (rnd(i, 520 + d) * Math.max(0, (top - Math.max(below, top - 0.5)) - hgt - 0.12))) );
          put(m, cx + (ox * 0.5) + (tx * along), y0, cz + (oz * 0.5) + (tz * along), yawFor(d) + (Math.PI / 2));
        }
      }

      // Ground details (view.groundDecor): fallen leaves near and in
      // forests, gravel near grey rock, pebbles anywhere, flowers in
      // patches away from forests; groundDecorDensity scales how many.
      //
      const plain = ( (c === Cell.GROUND) && !w.track[i] && !w.stack[i] && !w.bridge[i] );
      if ( V.groundDecor && ( plain || (c === Cell.TREE) ) ) {
        const dn = V.groundDecorDensity, nf = this.nearForest[i], nr = this.nearRock[i],
              spot = (k: number): [number, number] => [x + 0.2 + (0.6 * rnd(i, 400 + k)), y + 0.2 + (0.6 * rnd(i, 410 + k))],
              yaw  = (k: number) => (rnd(i, 420 + k) * Math.PI * 2);
        const opts: [Vox[], number][] = [
          [this.m.leaves, ( (c === Cell.TREE) ? 0.6 : (0.9 * nf) )],
          [this.m.gravel, ( plain ? (1.2 * nr) : 0 )],
          [this.m.pebbles, ( plain ? 0.12 : 0 )],
          [this.m.flowers, ( (plain && (noise2(x, y, 5, 77) > 0.62)) ? (0.35 * (1 - nf)) : 0 )],
        ];
        opts.forEach(([set, p], k) => {
          if (rnd(i, 430 + k) >= (p * dn)) { return; }
          const [px, pz] = spot(k);
          put(set[hash(i + k) % set.length], px, topY(h) + 0.005, pz, yaw(k));
        });
      }

      // Grass tufts on plain ground, thicker in some areas than others.
      //
      if ( (c === Cell.GROUND) && !w.track[i] && !w.stack[i] && !w.bridge[i] ) {
        const dens = noise2(x, y, 6, 47), n = ( (dens > 0.42) ? (1 + (hash(i + 99) % 3)) : ( ((hash(i + 7) % 5) === 0) ? 1 : 0 ) );
        for (let k = 0; k < n; k++) {
          const r = hash((i * 31) + k);
          put(this.m.grass[r % this.m.grass.length], x + 0.15 + (((r >>> 8) & 255) / 255) * 0.7, topY(h),
              y + 0.15 + (((r >>> 16) & 255) / 255) * 0.7, ((r >>> 4) & 3) * (Math.PI / 2));
        }
      }
    }

    const flat = new Set<Vox>([...this.m.grass, ...this.m.pebbles, ...this.m.flowers, ...this.m.leaves, ...this.m.gravel,
                               ...this.m.vine, ...this.m.sideStone, ...this.m.grassFringe, ...this.m.carvedRelief]),
          swaying = new Set<Vox>([...this.m.trees, ...this.m.bush]);
    // Carved grey rock: the chunk's blocks merged into one mesh, each
    // block moved to its cell and its colours tinted.
    //
    if (rockParts.length) {
      let nv = 0, ni = 0;
      for (const p of rockParts) { nv += p.g.getAttribute("position").count; ni += p.g.index!.count; }
      const pos = new Float32Array(3 * nv), nor = new Float32Array(3 * nv), col = new Float32Array(3 * nv),
            idx = new Uint32Array(ni);
      let ov = 0, oi = 0;
      for (const p of rockParts) {
        const P = p.g.getAttribute("position"), N = p.g.getAttribute("normal"), C = p.g.getAttribute("color"), I = p.g.index!;
        for (let k = 0; k < P.count; k++) {
          pos[3 * (ov + k)] = P.getX(k) + p.x; pos[(3 * (ov + k)) + 1] = P.getY(k) + p.y; pos[(3 * (ov + k)) + 2] = P.getZ(k) + p.z;
          nor[3 * (ov + k)] = N.getX(k); nor[(3 * (ov + k)) + 1] = N.getY(k); nor[(3 * (ov + k)) + 2] = N.getZ(k);
          col[3 * (ov + k)] = C.getX(k) * p.t[0]; col[(3 * (ov + k)) + 1] = C.getY(k) * p.t[1]; col[(3 * (ov + k)) + 2] = C.getZ(k) * p.t[2];
        }
        for (let k = 0; k < I.count; k++) { idx[oi + k] = I.getX(k) + ov; }
        ov += P.count; oi += I.count;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.vmat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.own = true;
      mesh.userData.rockCells = rockParts.length;
      grp.add(mesh);
    }

    for (const [m, { mats, cols }] of place) {
      const im = new THREE.InstancedMesh(this.vgeo(m), ( (V.treeSway && swaying.has(m)) ? this.tmat : this.vmat ), mats.length);
      im.userData.vox = m;
      im.castShadow = !flat.has(m);
      im.receiveShadow = true;
      mats.forEach((mt, k) => im.setMatrixAt(k, mt));
      if (cols.some(cl => cl)) {
        cols.forEach((cl, k) => im.setColorAt(k, cl ?? new THREE.Color(1, 1, 1)));
        im.instanceColor!.needsUpdate = true;
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      grp.add(im);
    }
  }
}
