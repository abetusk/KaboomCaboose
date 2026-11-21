// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The voxel font (2026-11-19): every message, countdown and player name
// in the game is drawn in blocks (src/client/voxtext.ts). Glyphs are 5
// blocks high, most 3 wide (M and W 5, N 4), rows top to bottom, "#" a
// block. The digits and S, T, A, R
// are the ones the START sign and the dynamite wagon's cost plate have
// used since 2026-11-18. Lower case is drawn as upper case.
//

export const GLYPHS: Record<string, string[]> = {
  "A": ["###", "#.#", "###", "#.#", "#.#"], "B": ["##.", "#.#", "##.", "#.#", "##."],
  "C": ["###", "#..", "#..", "#..", "###"], "D": ["##.", "#.#", "#.#", "#.#", "##."],
  "E": ["###", "#..", "##.", "#..", "###"], "F": ["###", "#..", "##.", "#..", "#.."],
  "G": ["###", "#..", "#.#", "#.#", "###"], "H": ["#.#", "#.#", "###", "#.#", "#.#"],
  "I": ["###", ".#.", ".#.", ".#.", "###"], "J": ["..#", "..#", "..#", "#.#", "###"],
  "K": ["#.#", "#.#", "##.", "#.#", "#.#"], "L": ["#..", "#..", "#..", "#..", "###"],
  "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  "N": ["#..#", "##.#", "#.##", "#..#", "#..#"],
  "O": ["###", "#.#", "#.#", "#.#", "###"], "P": ["###", "#.#", "###", "#..", "#.."],
  "Q": ["###", "#.#", "#.#", "###", "..#"], "R": ["##.", "#.#", "##.", "#.#", "#.#"],
  "S": ["###", "#..", "###", "..#", "###"], "T": ["###", ".#.", ".#.", ".#.", ".#."],
  "U": ["#.#", "#.#", "#.#", "#.#", "###"], "V": ["#.#", "#.#", "#.#", "#.#", ".#."],
  "W": ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  "X": ["#.#", "#.#", ".#.", "#.#", "#.#"], "Y": ["#.#", "#.#", ".#.", ".#.", ".#."],
  "Z": ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"], "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"], "3": ["###", "..#", ".##", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"], "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"], "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"], "9": ["###", "#.#", "###", "..#", "###"],
  "!": ["#", "#", "#", ".", "#"], ".": [".", ".", ".", ".", "#"],
  "?": ["###", "..#", ".##", "...", ".#."], "-": ["...", "...", "###", "...", "..."],
  "_": ["...", "...", "...", "...", "###"], "'": ["#", "#", ".", ".", "."],
  ",": [".", ".", ".", "#", "#"], ":": [".", "#", ".", "#", "."],
  "/": ["..#", "..#", ".#.", "#..", "#.."], "+": ["...", ".#.", "###", ".#.", "..."],
  "(": [".#", "#.", "#.", "#.", ".#"], ")": ["#.", ".#", ".#", ".#", "#."],
  "&": [".#.", "#.#", ".#.", "#.#", ".##"], "#": ["#.#", "###", "#.#", "###", "#.#"],
  " ": ["..", "..", "..", "..", ".."],
};

export const GLYPH_H = 5;

// Blocks between glyphs, and between lines.
//
export const GLYPH_GAP = 1,
             LINE_GAP  = 2;

// True if every character of `text` has a glyph.
//
export function drawable(text: string): boolean {
  return [...text.toUpperCase()].every(ch => (ch in GLYPHS));
}

// A line's width in blocks (an unknown character counts as a space).
//
export function lineWidth(text: string): number {
  const cs = [...text.toUpperCase()];
  return cs.reduce((s, ch) => (s + (GLYPHS[ch] ?? GLYPHS[" "])[0].length), 0) + (GLYPH_GAP * Math.max(0, cs.length - 1));
}

// The blocks of one line: [column, row] with column 0 at the line's west
// end and row 0 at its bottom, and a value per block from `tag` (for the
// part of the line it belongs to).
//
export function lineBlocks(text: string, tag: (k: number) => number = () => 0): [number, number, number][] {
  const out = [] as [number, number, number][];
  let x = 0;
  [...text.toUpperCase()].forEach((ch, k) => {
    const rows = GLYPHS[ch] ?? GLYPHS[" "];
    rows.forEach((row, r) => {
      [...row].forEach((c, j) => { if (c === "#") { out.push([x + j, (GLYPH_H - 1) - r, tag(k)]); } });
    });
    x += rows[0].length + GLYPH_GAP;
  });
  return out;
}
