// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Text in blocks (2026-11-19): the game's messages and countdowns, in the
// voxel font (src/client/voxfont.ts). One instanced mesh per text, so a
// text is one draw call however long. Unlit, with each face of a block
// shaded by its side as a lit block would be, so it reads the same in
// shadow, at night and in AR. Lines are centred on the text's origin,
// the last line's foot at the origin, so a text grows upward from where
// it is put. A text faces +z; face() turns it toward the viewer about
// the vertical only, so its blocks stay upright.
//

import * as THREE from "three";
import { lineWidth, lineBlocks, GLYPH_H, LINE_GAP } from "./voxfont.ts";

export const CREAM = 0xf4ecd0,
             GOLD  = 0xf0c040,
             RED   = 0xe83020;

// A dark outline (2026-11-19) keeps light letters readable over light
// ground and buildings: behind each block, a dark block OUTLINE times
// its size.
//
const DARK    = 0x241a12,
      OUTLINE = 1.6;

// A run of text in one colour; a line of runs, `scale` times the text's
// block size.
//
export interface Part {
  text    : string;
  colour? : number;
}

export interface Line {
  parts  : Part[];
  scale? : number;
}

export type TextLine = string | Line;

// One block, with its faces shaded: +x, -x, +y (top), -y, +z (front),
// -z, as BoxGeometry orders them.
//
const SHADE = [0.72, 0.72, 0.9, 0.5, 1.0, 0.6];

function blockGeometry(): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1), n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const s = SHADE[Math.floor(v / 4)];
    c[(v * 3)] = s; c[(v * 3) + 1] = s; c[(v * 3) + 2] = s;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

const GEO = blockGeometry(),
      MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });

const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), C = new THREE.Color();

function asLine(l: TextLine, colour: number): Line {
  return ( (typeof l === "string") ? { parts: [{ text: l, colour }] } : { parts: l.parts.map(p => ({ text: p.text, colour: (p.colour ?? colour) })), scale: l.scale } );
}

export class VoxText {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private key = "";

  // Size in board units of what is shown.
  //
  width  = 0;
  height = 0;

  // `px`: a block's side in board units; `colour` for lines and parts
  // that give none; `depth`: a block's depth over its side.
  //
  readonly px     : number;
  readonly colour : number;
  readonly depth  : number;

  constructor(px: number, colour = CREAM, depth = 1) {
    this.px     = px;
    this.colour = colour;
    this.depth  = depth;
    this.group.visible = false;
  }

  // Show these lines (empty strings are left out); nothing to show hides
  // the text. Rebuilt only when the lines change.
  //
  set(lines: TextLine[]): void {
    const ls  = lines.filter(l => ( (typeof l !== "string") || (l !== "") )).map(l => asLine(l, this.colour)),
          key = JSON.stringify(ls);
    this.group.visible = (ls.length > 0);
    if (key === this.key) { return; }
    this.key = key;

    // Every block: centre x, y, side, colour. Lines from the bottom up.
    //
    const blocks = [] as [number, number, number, number][];
    let y = 0, wMax = 0;
    for (let k = ls.length - 1; k >= 0; k--) {
      const l = ls[k], s = this.px * (l.scale ?? 1), text = l.parts.map(p => p.text).join(""),
            ends = [] as number[];
      let n = 0;
      for (const p of l.parts) { n += [...p.text].length; ends.push(n); }
      const w = lineWidth(text) * s;
      wMax = Math.max(wMax, w);
      for (const [bx, by, part] of lineBlocks(text, ch => ends.findIndex(e => (ch < e)))) {
        blocks.push([(-w / 2) + ((bx + 0.5) * s), y + ((by + 0.5) * s), s, (l.parts[part].colour ?? this.colour)]);
      }
      y += (GLYPH_H + ( (k > 0) ? LINE_GAP : 0 )) * s;
    }
    this.width  = wMax;
    this.height = y;

    const n = blocks.length * 2;
    if ( !this.mesh || (this.mesh.instanceMatrix.count < n) ) {
      if (this.mesh) { this.group.remove(this.mesh); this.mesh.dispose(); }
      let cap = 64;
      while (cap < n) { cap *= 2; }
      this.mesh = new THREE.InstancedMesh(GEO, MAT, cap);
      this.mesh.frustumCulled = false;
      this.group.add(this.mesh);
    }
    const mesh = this.mesh;
    blocks.forEach(([bx, by, s, colour], i) => {
      const d = s * this.depth;
      M.compose(P.set(bx, by, 0), Q, S.set(s, s, d));
      mesh.setMatrixAt(i, M);
      mesh.setColorAt(i, C.setHex(colour));
      M.compose(P.set(bx, by, -d * 0.6), Q, S.set(s * OUTLINE, s * OUTLINE, d));
      mesh.setMatrixAt(blocks.length + i, M);
      mesh.setColorAt(blocks.length + i, C.setHex(DARK));
    });
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) { mesh.instanceColor.needsUpdate = true; }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mesh?.dispose();
  }

  // Turn to face `eye` (a point in the frame of the text's parent) about
  // the vertical.
  //
  face(eye: THREE.Vector3): void {
    const g = this.group;
    g.rotation.y = Math.atan2(eye.x - g.position.x, eye.z - g.position.z);
  }
}
