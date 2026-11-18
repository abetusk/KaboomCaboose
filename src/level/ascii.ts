// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Terminal rendering of a level: 24-bit ANSI colour with Unicode glyphs,
// or plain ASCII. Height is shown by brightness (higher is lighter), and
// ramps by an arrow pointing uphill.
//

import { Cell, Grid, isRamp, DIR_NONE } from "./cells.ts";

export interface AsciiOpts {
  color   : boolean;
  unicode : boolean;

  // 24-bit colour escapes. Off by default: terminals without 24-bit
  // support misread them and show wrong colours. The default uses the
  // 256-colour palette, which nearly all terminals support.
  //
  truecolor : boolean;

  // Two characters per cell, so cells look roughly square in a terminal.
  //
  wide : boolean;
}

// Overlay marks drawn on top of cells, keyed by cell index.
//
export type Overlay = Map<number, string>;

type RGB = [number, number, number];

interface Style {
  uni : string;
  asc : string;
  fg  : RGB;
  bg  : RGB;
}

const STYLE: Record<number, Style> = {
  [Cell.AIR]            : { uni: " ", asc: " ", fg: [200, 200, 200], bg: [  0,   0,   0] },
  [Cell.GROUND]         : { uni: "·", asc: ".", fg: [210, 180, 130], bg: [150, 110,  70] },
  [Cell.TREE]           : { uni: "♣", asc: "T", fg: [140, 230, 120], bg: [ 30, 100,  40] },
  [Cell.WATER]          : { uni: "≈", asc: "~", fg: [180, 220, 255], bg: [ 40,  90, 170] },
  [Cell.ROCK]           : { uni: "▲", asc: "o", fg: [250, 250, 250], bg: [130, 130, 135] },
  [Cell.BLACKROCK]      : { uni: "▓", asc: "#", fg: [ 60,  60,  65], bg: [ 25,  25,  30] },
  [Cell.STATION]        : { uni: "■", asc: "S", fg: [ 20,  20,  20], bg: [235, 175,  40] },
  [Cell.RAMP_GROUND]    : { uni: "↑", asc: "^", fg: [255, 240, 200], bg: [170, 120,  60] },
  [Cell.RAMP_BLACKROCK] : { uni: "↑", asc: "^", fg: [160, 160, 170], bg: [ 45,  45,  55] },
  [Cell.TRACK]          : { uni: "═", asc: "=", fg: [230, 230, 230], bg: [110,  60,  30] },
};

export // 256-colour palette: per cell type, background colours from lowest to
// highest height level (five steps, lighter is higher), and a glyph colour.
//
const STYLE256: Record<number, { fg: number, bg: number[] }> = {
  [Cell.AIR]            : { fg: 250, bg: [ 16,  16,  16,  16,  16] },
  [Cell.GROUND]         : { fg: 223, bg: [ 94, 130, 137, 180, 186] },
  [Cell.TREE]           : { fg: 120, bg: [ 22,  28,  34,  70, 106] },
  [Cell.WATER]          : { fg: 153, bg: [ 17,  18,  25,  32,  39] },
  [Cell.ROCK]           : { fg: 255, bg: [240, 243, 246, 249, 252] },
  [Cell.BLACKROCK]      : { fg: 238, bg: [232, 233, 234, 235, 236] },
  [Cell.STATION]        : { fg:  16, bg: [214, 214, 214, 214, 214] },
  [Cell.RAMP_GROUND]    : { fg: 230, bg: [ 94, 130, 137, 180, 186] },
  [Cell.RAMP_BLACKROCK] : { fg: 248, bg: [232, 233, 234, 235, 236] },
  [Cell.TRACK]          : { fg: 252, bg: [ 94,  94,  94,  94,  94] },
};

const OVERLAY_FG_256 = 226;

export const ARROW_UNI = ["↑", "→", "↓", "←"],
             ARROW_ASC = ["^", ">", "v", "<"];

const OVERLAY_FG: RGB = [255, 255, 60];

let TRUE = false;

// Escape for a cell of type c at height z (of top), optionally with the
// overlay glyph colour.
//
function cellEsc(c: number, z: number, top: number, overlay: boolean): string {
  if (TRUE) {
    const st = STYLE[c];
    return ( "\x1b[38;2;" + (overlay ? OVERLAY_FG : shade(st.fg, z, top)).join(";") +
             ";48;2;" + shade(st.bg, z, top).join(";") + "m" );
  }
  const st = STYLE256[c],
        k  = ( (top > 0) ? Math.round((4 * z) / top) : 2 );
  return "\x1b[38;5;" + (overlay ? OVERLAY_FG_256 : st.fg) + ";48;5;" + st.bg[k] + "m";
}

const RESET = "\x1b[0m";

// Brightness by height: lowest level 0.6, highest 1.15.
//
function shade(c: RGB, z: number, top: number): RGB {
  const k = ( (top > 0) ? (0.6 + (0.55 * (z / top))) : 1 );
  return c.map(v => Math.min(255, Math.round(v * k))) as RGB;
}

function glyph(g: Grid, i: number, o: AsciiOpts): string {
  const c = g.cells[i], st = STYLE[c];
  if ( isRamp(c) && (g.dir[i] !== DIR_NONE) ) {
    return ( o.unicode ? ARROW_UNI[g.dir[i]] : ARROW_ASC[g.dir[i]] );
  }
  return ( o.unicode ? st.uni : st.asc );
}

export function render(g: Grid, o: AsciiOpts, overlay: Overlay = new Map()): string {
  TRUE = o.truecolor;
  const lines = [] as string[];
  let top = 0;
  for (let i = 0; i < g.height.length; i++) { top = Math.max(top, g.height[i]); }

  // Ruler with a tick every 10 cells.
  //
  let ruler = "";
  for (let x = 0; x < g.w; x++) {
    const t = ( ((x % 10) === 0) ? String((x / 10) % 10) : " " );
    ruler += ( o.wide ? (t + " ") : t );
  }
  lines.push("    " + ruler);

  for (let y = 0; y < g.h; y++) {
    let row = String(y).padStart(3) + " ";
    for (let x = 0; x < g.w; x++) {
      const i  = (y * g.w) + x,
            ov = overlay.get(i),
            gl = ( (ov !== undefined) ? ov : glyph(g, i, o) ),
            ch = ( o.wide ? (gl + gl) : gl );
      if (o.color) {
        row += cellEsc(g.cells[i], g.height[i], top, (ov !== undefined)) + ch;
      }
      else {
        row += ch;
      }
    }
    lines.push(row + ( o.color ? RESET : "" ));
  }
  return lines.join("\n");
}

export function legend(o: AsciiOpts, marks: [string, string][]): string {
  TRUE = o.truecolor;
  const items: [number, string][] = [
    [Cell.GROUND, "ground"], [Cell.TREE, "tree"], [Cell.ROCK, "rock"],
    [Cell.BLACKROCK, "black rock"], [Cell.WATER, "water"], [Cell.STATION, "station"],
    [Cell.RAMP_GROUND, "ramp (arrow points uphill)"],
  ];
  const parts = items.map(([c, name]) => {
    const st = STYLE[c], ch = ( o.unicode ? st.uni : st.asc );
    return ( o.color ? (cellEsc(c, 1, 2, false) + " " + ch + " " + RESET) : ch ) + " " + name;
  });
  for (const [m, name] of marks) {
    parts.push( ( o.color ? (cellEsc(Cell.GROUND, 1, 2, true) + " " + m + " " + RESET) : m ) + " " + name );
  }
  if (o.color) { parts.push("lighter = higher"); }
  return parts.join("   ");
}
