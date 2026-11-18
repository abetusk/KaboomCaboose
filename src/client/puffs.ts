// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Boost puff (D2.10): a few faint dust balls kicked out behind a
// character's feet when a boost starts. Each grows a little, drifts back
// and shrinks away within half a second; light enough to read as a cue,
// not an effect.
//

import * as THREE from "three";

const MAX = 120;

interface Puff {
  p    : THREE.Vector3;
  v    : THREE.Vector3;
  age  : number;
  life : number;
  size : number;
}

export class Puffs {
  mesh  : THREE.InstancedMesh;
  puffs : Puff[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
                                        new THREE.MeshBasicMaterial({ color: 0xe8e4dc, transparent: true, opacity: 0.3, depthWrite: false }), MAX);
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
  }

  // A puff at the feet (x, y, z; three.js axes) of a character heading
  // along (hx, hz) on the ground.
  //
  burst(x: number, y: number, z: number, hx: number, hz: number): void {
    for (let k = 0; k < 5; k++) {
      if (this.puffs.length >= MAX) { this.puffs.shift(); }
      const side = (Math.random() - 0.5) * 1.2, back = 0.5 + (Math.random() * 0.4);
      this.puffs.push({
        p    : new THREE.Vector3(x - (hx * 0.1), y + 0.04, z - (hz * 0.1)),
        v    : new THREE.Vector3((-hx * back) + (-hz * side), 0.15 + (Math.random() * 0.15), (-hz * back) + (hx * side)),
        age  : 0,
        life : 0.35 + (Math.random() * 0.15),
        size : 0.05 + (Math.random() * 0.03),
      });
    }
  }

  update(dt: number): void {
    this.puffs = this.puffs.filter(f => ((f.age += dt) < f.life));
    this.puffs.forEach((f, k) => {
      f.p.addScaledVector(f.v, dt);
      f.v.multiplyScalar(Math.max(0, 1 - (dt * 4)));
      const u = f.age / f.life, sz = f.size * (1 + (1.5 * u)) * Math.min(1, 3 * (1 - u));
      this.s.set(sz, sz, sz);
      this.m.compose(f.p, this.q, this.s);
      this.mesh.setMatrixAt(k, this.m);
    });
    this.mesh.count = this.puffs.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
