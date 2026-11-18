// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The tool in a character's right hand (D11a.4): a pickaxe or an axe,
// built from a few boxes, held on the right arm bone so it swings with
// the arm when the character hits.
//
// The Kenney characters' arm bones point sideways (-x for the right
// arm) in their rest pose, with the hand about 0.24 along the arm and
// forward (+z) the way the character faces; idle and walking lower the
// arm 45 degrees (measured from the models' arm vertices and animation
// tracks). The handle goes forward out of the fist, tilted up, so the
// head sits in front of the character.
//

import * as THREE from "three";

export const HAND = new THREE.Vector3(-0.24, 0, 0.04);

const WOOD  = new THREE.MeshLambertMaterial({ color: 0x8a5a2b }),
      STEEL = new THREE.MeshLambertMaterial({ color: 0xa4a9ae }),
      EDGE  = new THREE.MeshLambertMaterial({ color: 0xd4d8dc });

// Handle direction (forward, tilted up) and the direction across it in
// the same upright plane, in the bone's axes.
//
const ALONG  = new THREE.Vector3(0, 0.5, 0.866),
      ACROSS = new THREE.Vector3(0, 0.866, -0.5);

function box(sx: number, sy: number, sz: number, m: THREE.Material, at: THREE.Vector3): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  o.position.copy(at);
  o.castShadow = true;
  return o;
}

// kind: "pick" or "axe". The group's origin is the fist; at scale 1
// the tool is 0.22 cells long, about a quarter of a character's height
// (view.toolScale sets the scale).
//
export function handTool(kind: "pick" | "axe"): THREE.Group {
  const g = new THREE.Group(), inner = new THREE.Group();

  // Built along z (handle) and y (across), then turned so z lies along
  // ALONG; the fist holds the handle a third of the way up.
  //
  // The head's parts are named "head" so an upgrade can recolour them
  // (src/client/gear.ts); the inner group is named "tool" for the same.
  //
  const L = 0.22, top = L * 0.67, head = (o: THREE.Mesh) => { o.name = "head"; inner.add(o); };
  inner.name = "tool";
  inner.add(box(0.018, 0.018, L, WOOD, new THREE.Vector3(0, 0, top - (L / 2))));
  if (kind === "pick") {
    head(box(0.022, 0.15, 0.024, STEEL, new THREE.Vector3(0, 0, top - 0.01)));
    head(box(0.016, 0.02, 0.018, EDGE, new THREE.Vector3(0, 0.083, top - 0.018)));
    head(box(0.016, 0.02, 0.018, EDGE, new THREE.Vector3(0, -0.083, top - 0.018)));
  }
  else {
    head(box(0.016, 0.075, 0.07, STEEL, new THREE.Vector3(0, -0.035, top - 0.03)));
    head(box(0.012, 0.012, 0.08, EDGE, new THREE.Vector3(0, -0.076, top - 0.03)));
  }
  inner.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(ACROSS, ALONG), ACROSS, ALONG));
  g.add(inner);
  g.position.copy(HAND);
  return g;
}
