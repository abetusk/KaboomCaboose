// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Read a binary glTF (.glb) mesh in its rest pose, for preview images.
// The game loads .glb files with three.js; this exists so the asset
// gallery can show meshes next to the voxel tiles.
//
// Only what Kenney's characters use: indexed triangle primitives with
// POSITION and TEXCOORD_0, one external colour texture. Skinned meshes
// are taken as authored (the bind pose), and node transforms of the mesh
// nodes are ignored, which is correct for Kenney's characters (their
// mesh nodes carry no transform).
//

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { decodePng, sample } from "../vox/png.ts";
import type { Tri } from "../vox/render.ts";

export interface Glb {
  tris       : { p: [number, number, number][], uv: [number, number][] }[];
  animations : string[];
  texture    : string | null;
  min        : [number, number, number];
  max        : [number, number, number];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function readGlb(path: string): Glb {
  const d = readFileSync(path);
  if (d.toString("ascii", 0, 4) !== "glTF") { throw new Error(path + ": not a .glb file"); }
  const jlen = d.readUInt32LE(12),
        j    = JSON.parse(d.toString("utf8", 20, 20 + jlen)),
        boff = 20 + jlen + 8;

  // Read accessor k as an array of tuples (floats or unsigned ints).
  //
  const read = (k: number): number[][] => {
    const a  = j.accessors[k],
          bv = j.bufferViews[a.bufferView],
          nc = COMPONENTS[a.type],
          sz = ( (a.componentType === 5126) || (a.componentType === 5125) ) ? 4 : ( (a.componentType === 5123) ? 2 : 1 ),
          st = bv.byteStride ?? (nc * sz),
          o0 = boff + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0),
          out = [] as number[][];
    for (let i = 0; i < a.count; i++) {
      const t = [] as number[];
      for (let c = 0; c < nc; c++) {
        const o = o0 + (i * st) + (c * sz);
        if      (a.componentType === 5126) { t.push(d.readFloatLE(o)); }
        else if (a.componentType === 5125) { t.push(d.readUInt32LE(o)); }
        else if (a.componentType === 5123) { t.push(d.readUInt16LE(o)); }
        else                               { t.push(d[o]); }
      }
      out.push(t);
    }
    return out;
  };

  const tris = [] as Glb["tris"],
        min: [number, number, number] = [Infinity, Infinity, Infinity],
        max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const m of j.meshes) {
    for (const pr of m.primitives) {
      if ( (pr.mode ?? 4) !== 4 ) { continue; }
      const pos = read(pr.attributes.POSITION),
            uv  = ( (pr.attributes.TEXCOORD_0 !== undefined) ? read(pr.attributes.TEXCOORD_0) : pos.map(() => [0, 0]) ),
            idx = ( (pr.indices !== undefined) ? read(pr.indices).map(t => t[0]) : pos.map((_, i) => i) );
      for (const p of pos) {
        for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], p[c]); max[c] = Math.max(max[c], p[c]); }
      }
      for (let i = 0; (i + 2) < idx.length; i += 3) {
        const t = [idx[i], idx[i + 1], idx[i + 2]];
        tris.push({
          p  : t.map(k => [pos[k][0], pos[k][1], pos[k][2]] as [number, number, number]),
          uv : t.map(k => [uv[k][0], uv[k][1]] as [number, number]),
        });
      }
    }
  }
  return {
    tris,
    animations : (j.animations ?? []).map((a: { name: string }) => a.name),
    texture    : j.images?.[0]?.uri ?? null,
    min, max,
  };
}

// Triangles for the preview renderer: glTF (x right, y up, z forward) is
// turned so the model faces +x with z up, scaled by `s` voxels per glTF
// unit, and placed with its feet centred at (ox, oy, oz). Each triangle
// takes the texture colour at its centroid (Kenney's colour map is flat
// swatches, so one colour per triangle is enough).
//
export function glbTris(g: Glb, glbPath: string, s: number, ox: number, oy: number, oz: number): Tri[] {
  const tex = ( g.texture ? decodePng(readFileSync(join(dirname(glbPath), g.texture))) : null );
  const map = (p: [number, number, number]): [number, number, number] =>
    [ox + (p[2] * s), oy + (p[0] * s), oz + ((p[1] - g.min[1]) * s)];
  return g.tris.map(t => {
    const u = (t.uv[0][0] + t.uv[1][0] + t.uv[2][0]) / 3,
          v = (t.uv[0][1] + t.uv[1][1] + t.uv[2][1]) / 3;
    return { p: t.p.map(map), c: ( tex ? sample(tex, u, v) : [200, 200, 200] ) };
  });
}
