// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Level palettes (2026-11-20, an experiment, off unless view.palette is
// set; D11.19): each level of a run takes one of the 500 five-colour
// palettes of nice-color-palettes (MIT, assets/third_party/
// nice-color-palettes), and its ground, trees, water, grey rock and black
// rock are recoloured to it. The colours go by lightness, darkest first:
// black rock, trees (and the forest floor), water, ground, grey rock.
//
// A surface is recoloured by a multiplier per colour channel that takes
// its usual average colour (BASE) to the palette's, so its texture and
// shading stay. view.paletteStrength scales the change (0 none, 1 full).
//
// Between two levels the palettes meet across the station they share:
// over view.paletteBlendCells cells around its middle each cell takes
// the next level's palette with a chance rising smoothly from 0 to 1
// along x, so the two mix square by square.
//

import PALETTES from "../../assets/third_party/nice-color-palettes/palettes500.json" with { type: "json" };

export const KINDS = ["black", "trees", "water", "ground", "rock"] as const;

export type Kind = typeof KINDS[number];

// Each surface's usual average colour: the designed tiles' main colours
// (src/client/tiles.ts, src/assets/bricks.ts) and the averages of the
// tree and water models' voxels (measured 2026-11-20).
//
export const BASE: Record<Kind, string> = {
  black  : "#3c3c46",
  trees  : "#2f9a3a",
  water  : "#1269a2",
  ground : "#b06a3e",
  rock   : "#999794",
};

// The tree models are darker than the forest floor tile.
//
export const TREE_MODEL_BASE = "#1c741f";

export const PALETTE_COUNT = (PALETTES as string[][]).length;

const lin = (c: number) => ( (c <= 0.04045) ? (c / 12.92) : (((c + 0.055) / 1.055) ** 2.4) );

export function linear(hex: string): [number, number, number] {
  return [1, 3, 5].map(k => lin(parseInt(hex.slice(k, k + 2), 16) / 255)) as [number, number, number];
}

// Small stable hash (as src/client/terrain.ts's).
//
function hash(i: number): number {
  let x = (i + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ( (x ^ (x >>> 16)) >>> 0 );
}

// Level k's palette (an index into the 500) for view.paletteSeed `seed`.
//
export function paletteIndex(seed: number, k: number): number {
  return ( hash((Math.round(seed) * 1009) + (k * 7919) + 13) % PALETTE_COUNT );
}

// A palette's colours by kind, darkest to lightest as KINDS.
//
export function byKind(index: number): Record<Kind, string> {
  const p   = [...(PALETTES as string[][])[index]],
        lum = (h: string) => { const [r, g, b] = linear(h); return ( (0.2126 * r) + (0.7152 * g) + (0.0722 * b) ); };
  p.sort((a, b) => (lum(a) - lum(b)));
  return Object.fromEntries(KINDS.map((k, n) => [k, p[n]])) as Record<Kind, string>;
}

// The multiplier taking `base` to `target`, by `strength`, each channel
// held to [0.05, 12] (a near-black channel would otherwise blow up).
//
export function multiplier(base: string, target: string, strength: number): [number, number, number] {
  const b = linear(base), t = linear(target);
  return [0, 1, 2].map(c => {
    const f = Math.max(0.05, Math.min(12, t[c] / Math.max(1e-4, b[c])));
    return ( 1 + (strength * (f - 1)) );
  }) as [number, number, number];
}

// Which level's palette colours cell (x, y): `mids` are the x of the
// middles of the stations between levels, west to east; `blend` the
// width of the mixing band; `key` a per-cell number for the draw.
//
export function levelAt(x: number, mids: number[], blend: number, key: number): number {
  const u = (hash(key + 4049) / 4294967296), half = Math.max(0, blend) / 2;
  let k = 0;
  for (const m of mids) {
    const cx = x + 0.5;
    if (cx >= (m + half)) { k++; continue; }
    if (cx <= (m - half)) { break; }
    const s = (cx - (m - half)) / Math.max(1e-6, blend), p = s * s * (3 - (2 * s));
    if (u < p) { k++; continue; }
    break;
  }
  return k;
}

// Multipliers for every level of a run, by kind (with the tree models'
// own), for view.paletteSeed and view.paletteStrength.
//
export interface LevelColours {
  kinds : Record<Kind, [number, number, number]>;
  tree  : [number, number, number];
}

export function levelColours(levels: number, seed: number, strength: number): LevelColours[] {
  return Array.from({ length: Math.max(1, levels) }, (_, k) => {
    const p = byKind(paletteIndex(seed, k));
    return {
      kinds : Object.fromEntries(KINDS.map(c => [c, multiplier(BASE[c], p[c], strength)])) as Record<Kind, [number, number, number]>,
      tree  : multiplier(TREE_MODEL_BASE, p.trees, strength),
    };
  });
}
