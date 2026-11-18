// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Mining and chopping feedback (D11.16): chips of stone that burst from
// grey rock when it is hit, and a bigger burst with dust when it breaks;
// wood chips and leaves from trees. Chips are small boxes that fly out,
// fall, bounce once on the ground and fade. A burst can make them flat
// (flakes, leaves) and slow them with drag, so leaves drift down
// instead of dropping.
//

import * as THREE from "three";

const MAX = 400;

interface Chip {
  p    : THREE.Vector3;
  v    : THREE.Vector3;
  spin : THREE.Vector3;
  r    : THREE.Euler;
  life : number;
  age  : number;
  size : number;
  floor: number;
  col  : THREE.Color;
  grav : number;
  drag : number;
  flat : number;
}

// gravity: cells per second squared; drag: share of speed lost per
// second; flat: the chip's height as a share of its width.
//
export interface ChipStyle {
  gravity? : number;
  drag?    : number;
  flat?    : number;
  life?    : number;
}

export class Chips {
  mesh  : THREE.InstancedMesh;
  chips : Chip[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAX);
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  }

  // A burst of n chips from point (x, y, z) (three.js axes), thrown up
  // and out at about `speed` cells per second, in the given colours
  // (linear RGB), landing on the plane y = floor.
  //
  burst(x: number, y: number, z: number, n: number, speed: number, colours: THREE.Color[], floor: number, size = 0.07, style: ChipStyle = {}): void {
    for (let k = 0; k < n; k++) {
      if (this.chips.length >= MAX) { this.chips.shift(); }
      const a = Math.random() * Math.PI * 2, up = 0.6 + (Math.random() * 0.8), sp = speed * (0.5 + Math.random());
      this.chips.push({
        p    : new THREE.Vector3(x + ((Math.random() - 0.5) * 0.4), y + (Math.random() * 0.1), z + ((Math.random() - 0.5) * 0.4)),
        v    : new THREE.Vector3(Math.cos(a) * sp, up * speed * 1.4, Math.sin(a) * sp),
        spin : new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
        r    : new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        life : (style.life ?? 0.6) + (Math.random() * 0.5),
        age  : 0,
        size : size * (0.6 + (Math.random() * 0.8)),
        floor,
        col  : colours[k % colours.length],
        grav : style.gravity ?? 9.8,
        drag : style.drag ?? 0,
        flat : style.flat ?? 1,
      });
    }
  }

  update(dt: number): void {
    const keep = [] as Chip[];
    for (const c of this.chips) {
      c.age += dt;
      if (c.age >= c.life) { continue; }
      c.v.y -= c.grav * dt;
      c.v.multiplyScalar(Math.max(0, 1 - (c.drag * dt)));
      c.p.addScaledVector(c.v, dt);
      if (c.p.y < (c.floor + (c.size / 2))) {
        c.p.y = c.floor + (c.size / 2);
        c.v.y = Math.abs(c.v.y) * 0.3;
        c.v.x *= 0.5; c.v.z *= 0.5;
        c.spin.multiplyScalar(0.5);
      }
      c.r.x += c.spin.x * dt; c.r.y += c.spin.y * dt; c.r.z += c.spin.z * dt;
      keep.push(c);
    }
    this.chips = keep;
    keep.forEach((c, k) => {
      const fade = Math.min(1, 3 * (1 - (c.age / c.life))), sz = c.size * fade;
      this.s.set(sz, sz * c.flat, sz);
      this.m.compose(c.p, this.q.setFromEuler(c.r), this.s);
      this.mesh.setMatrixAt(k, this.m);
      this.mesh.setColorAt(k, c.col);
    });
    this.mesh.count = keep.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) { this.mesh.instanceColor.needsUpdate = true; }
  }
}
