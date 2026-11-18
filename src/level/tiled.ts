// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Read and write levels in Tiled's JSON map format (.tmj).
// Format reference: Tiled docs json-map-format.rst, global-tile-ids.rst.
//
// One tile layer per height level, each with an int property `z`.
// GID 0 is open air. Layers that are not stored are open air above the
// lowest stored layer, and the map property `fill_below` below it.
//

import { gunzipSync, inflateSync, deflateSync, crc32 } from "node:zlib";
import { Cell, CELL_NAMES, DIRS, DIR_NONE, Grid, TILE_COUNT, cellFromName, isRamp } from "./cells.ts";

const TILE_PX = 16;

// Top four bits of a GID are flip flags. Bit 32 horizontal, bit 31
// vertical, bit 30 anti-diagonal; the diagonal flip is applied first.
//
const GID_MASK = 0x0fffffff;
const FLIP_H   = 0x80000000;
const FLIP_V   = 0x40000000;
const FLIP_D   = 0x20000000;

// The unrotated ramp tile rises toward north (-y). Rotations by flip
// flags: east = D+H (90 degrees clockwise), south = H+V, west = D+V.
//
export const DIR_FLAGS = [0, FLIP_D + FLIP_H, FLIP_H + FLIP_V, FLIP_D + FLIP_V];

function dirFromFlags(gid: number): number {
  const f = Math.floor(gid / 0x20000000) & 7;
  let x = 0, y = -1;
  if (f & 1) { const t = x; x = y; y = t; }
  if (f & 4) { x = -x; }
  if (f & 2) { y = -y; }
  return DIRS.findIndex(d => ( (d[0] === x) && (d[1] === y) ));
}

export interface TiledProperty {
  name  : string;
  type  : string;
  value : string | number | boolean;
}

// One tile layer per height level from 0 to the highest surface. Below a
// column's surface is ground; above it is open air (GID 0).
//
export function toTmj(g: Grid, props: TiledProperty[], tilesetSource: string): object {
  let top = 0;
  for (let i = 0; i < g.height.length; i++) { top = Math.max(top, g.height[i]); }

  const layers = [] as object[];
  for (let z = 0; z <= top; z++) {
    const data = new Array<number>(g.w * g.h);
    for (let i = 0; i < data.length; i++) {
      const s = g.height[i], c = g.cells[i];
      if      (z < s)          { data[i] = Cell.GROUND + 1; }
      else if (z > s)          { data[i] = 0; }
      else if (c === Cell.AIR) { data[i] = 0; }
      else {
        data[i] = (c + 1) + ( (isRamp(c) && (g.dir[i] !== DIR_NONE)) ? DIR_FLAGS[g.dir[i]] : 0 );
      }
    }
    layers.push({
      id         : z + 1,
      name       : "z" + z,
      type       : "tilelayer",
      x          : 0,
      y          : 0,
      width      : g.w,
      height     : g.h,
      opacity    : 1,
      visible    : true,
      properties : [ { name: "z", type: "int", value: z } ],
      data,
    });
  }

  return {
    type         : "map",
    version      : "1.10",
    orientation  : "orthogonal",
    renderorder  : "right-down",
    width        : g.w,
    height       : g.h,
    tilewidth    : TILE_PX,
    tileheight   : TILE_PX,
    infinite     : false,
    nextlayerid  : top + 2,
    nextobjectid : 1,
    properties   : [
      { name: "license",    type: "string", value: "CC0-1.0" },
      { name: "fill_below", type: "string", value: "blackrock" },
      ...props,
    ],
    layers,
    tilesets : [ { firstgid: 1, source: tilesetSource } ],
  };
}

export function tilesetTsj(image: string): object {
  const tiles = [] as object[];
  for (let i = 0; i < TILE_COUNT; i++) { tiles.push({ id: i, type: CELL_NAMES[i] }); }
  return {
    type        : "tileset",
    version     : "1.10",
    name        : "cells",
    tilewidth   : TILE_PX,
    tileheight  : TILE_PX,
    tilecount   : TILE_COUNT,
    columns     : TILE_COUNT,
    image,
    imagewidth  : TILE_PX * TILE_COUNT,
    imageheight : TILE_PX,
    margin      : 0,
    spacing     : 0,
    properties  : [ { name: "license", type: "string", value: "CC0-1.0" } ],
    tiles,
  };
}

// Placeholder tileset image: one flat colour per cell type with a darker
// border, so maps are readable when opened in Tiled.
//
const TILE_RGB: Record<number, [number, number, number]> = {
  [Cell.GROUND]         : [150, 120,  80],
  [Cell.TREE]           : [ 40, 120,  50],
  [Cell.WATER]          : [ 50, 110, 190],
  [Cell.ROCK]           : [150, 150, 155],
  [Cell.BLACKROCK]      : [ 35,  35,  40],
  [Cell.STATION]        : [230, 180,  40],
  [Cell.RAMP_GROUND]    : [190, 160, 110],
  [Cell.RAMP_BLACKROCK] : [ 80,  80,  90],
  [Cell.TRACK]          : [120,  70,  40],
};

export function tilesetPng(): Buffer {
  const w = TILE_PX * TILE_COUNT, h = TILE_PX,
        raw = Buffer.alloc(h * ((w * 3) + 1));
  for (let y = 0; y < h; y++) {
    const row = y * ((w * 3) + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const t  = Math.floor(x / TILE_PX), lx = x % TILE_PX,
            ed = ( (lx === 0) || (lx === (TILE_PX - 1)) || (y === 0) || (y === (h - 1)) ),
            k  = ( ed ? 0.7 : 1.0 ),
            c  = TILE_RGB[t];
      for (let ch = 0; ch < 3; ch++) { raw[row + 1 + (x * 3) + ch] = Math.round(c[ch] * k); }
    }
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4), crc = Buffer.alloc(4), tb = Buffer.from(type, "ascii");
    len.writeUInt32BE(body.length);
    crc.writeUInt32BE(crc32(Buffer.concat([tb, body])));
    return Buffer.concat([len, tb, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Tile layer data may be a JSON array or base64, optionally zlib or gzip
// compressed.
//
function layerData(layer: any): number[] {
  if (Array.isArray(layer.data)) { return layer.data; }
  let buf = Buffer.from(layer.data, "base64");
  if      (layer.compression === "zlib") { buf = inflateSync(buf); }
  else if (layer.compression === "gzip") { buf = gunzipSync(buf); }
  else if (layer.compression)            { throw new Error("unsupported compression: " + layer.compression); }
  const out = [] as number[];
  for (let i = 0; i < buf.length; i += 4) { out.push(buf.readUInt32LE(i)); }
  return out;
}

// Load a map into a Grid. Each column's surface is its highest non-empty
// cell over all layers with a `z` property; missing layers are open air.
// A column empty in every layer has its surface just below the lowest
// layer, made of the map's `fill_below` material. Tile types come from
// the tileset's per-tile `type` (Tiled 1.10+) or `class` (Tiled 1.9).
//
export function fromTmj(map: any, tileset: any): Grid {
  if (map.infinite) { throw new Error("infinite maps are not supported"); }
  const zOf = (l: any) => {
    const p = (l.properties || []).find((q: any) => (q.name === "z"));
    return ( p ? Number(p.value) : null );
  };
  const layers = map.layers.filter((l: any) => ( (l.type === "tilelayer") && (zOf(l) !== null) ))
                           .sort((a: any, b: any) => (zOf(a)! - zOf(b)!));
  if (!layers.length) { throw new Error("no tile layers with a z property"); }

  const firstgid = map.tilesets[0].firstgid,
        byId     = new Map<number, number>();
  for (const t of (tileset.tiles || [])) { byId.set(t.id, cellFromName(t.type ?? t.class)); }

  const fillProp = (map.properties || []).find((q: any) => (q.name === "fill_below")),
        fill     = cellFromName(fillProp ? fillProp.value : "blackrock"),
        lowZ     = zOf(layers[0])!;

  const g = new Grid(map.width, map.height, fill);
  g.height.fill(lowZ - 1);

  for (const layer of layers) {
    const z = zOf(layer)!, data = layerData(layer);
    for (let i = 0; i < data.length; i++) {
      const gid = data[i] & GID_MASK;
      if (gid === 0) { continue; }
      const c = byId.get(gid - firstgid);
      if (c === undefined) { throw new Error("tile id without a type: " + (gid - firstgid)); }
      if (z < g.height[i]) { continue; }
      g.cells[i]  = c;
      g.height[i] = z;
      g.dir[i]    = ( isRamp(c) ? dirFromFlags(data[i]) : DIR_NONE );
    }
  }
  return g;
}
