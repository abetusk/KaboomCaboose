// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Derailment explosion (D11.18), built from voxels like everything
// else: solid cubes, square to the level's axes, their places and sizes
// snapped to a grid of 1/16 cell, so the blast reads as blocks popping
// in and out rather than smooth blobs.
//
// - Fire: cubes that swell, rise and cool from white-yellow through
//   orange to dark red within about a second, then shrink away (bright
//   enough at first for the bloom filter to catch).
// - Smoke: grey cubes that rise and spread more slowly, gone within
//   about three seconds.
// - Junk: tumbling chunks of red, yellow and grey thrown out on arcs,
//   each streaming a trail of small cubes of its colour behind it that
//   shrink away, until it lands.
//
// Debris chips (src/client/chips.ts) add to it.
//

import * as THREE from "three";

const MAX_FIRE  = 90,
      MAX_SMOKE = 40,
      MAX_JUNK  = 16,
      MAX_TRAIL = 400;

// The blast radius (cells) the burst's spread was made for; a burst for
// a bigger radius is scaled by radius / BURST_RADIUS.
//
export const BURST_RADIUS = 1.5;

// Grid that places and sizes snap to, in cells.
//
const VOX = 1 / 16;

const snap   = (v: number) => ( Math.round(v / VOX) * VOX );
const snapSz = (v: number) => ( (v <= 1e-6) ? 0 : Math.max(VOX, Math.round(v / VOX) * VOX) );

interface Blob {
  p    : THREE.Vector3;
  v    : THREE.Vector3;
  age  : number;
  life : number;
  size : number;
  grow : number;
}

interface Junk {
  p     : THREE.Vector3;
  v     : THREE.Vector3;
  r     : THREE.Euler;
  spin  : THREE.Vector3;
  age   : number;
  life  : number;
  size  : number;
  col   : number;
  emit  : number;
  floor : number;
}

interface Trail {
  p    : THREE.Vector3;
  age  : number;
  life : number;
  size : number;
  col  : number;
  rise : number;
}

// Fire colour by age (0 to 1): white-yellow, orange, dark red, a dark
// ember. Values above 1 glow under bloom.
//
const HOT   = new THREE.Color(3.0, 2.4, 1.0),
      MID   = new THREE.Color(2.2, 0.8, 0.15),
      COOL  = new THREE.Color(0.45, 0.08, 0.03),
      EMBER = new THREE.Color(0.15, 0.05, 0.03);

export function fireColour(u: number, out = new THREE.Color()): THREE.Color {
  if (u < 0.3) { return out.copy(HOT).lerp(MID, u / 0.3); }
  if (u < 0.7) { return out.copy(MID).lerp(COOL, (u - 0.3) / 0.4); }
  return out.copy(COOL).lerp(EMBER, Math.min(1, (u - 0.7) / 0.3));
}

// Junk colours (red, yellow, grey) for the tumbling chunks, and the
// brighter versions their trails glow in (grey stays grey).
//
export const JUNK   = [new THREE.Color(0.8, 0.16, 0.1), new THREE.Color(0.95, 0.75, 0.15), new THREE.Color(0.48, 0.48, 0.5)];
export const STREAM = [new THREE.Color(2.2, 0.35, 0.15), new THREE.Color(2.4, 1.8, 0.35), new THREE.Color(0.55, 0.55, 0.57)];

export class Blast {
  fire   : THREE.InstancedMesh;
  smoke  : THREE.InstancedMesh;
  junk   : THREE.InstancedMesh;
  trail  : THREE.InstancedMesh;
  flames : Blob[] = [];
  puffs  : Blob[] = [];
  bits   : Junk[] = [];
  trails : Trail[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();
  private c = new THREE.Color();

  constructor() {
    const cube = new THREE.BoxGeometry(1, 1, 1),
          make = (mat: THREE.Material, n: number, coloured: boolean) => {
            const o = new THREE.InstancedMesh(cube, mat, n);
            o.count = 0;
            o.castShadow = false;
            o.frustumCulled = false;
            if (coloured) { o.setColorAt(0, new THREE.Color(1, 1, 1)); }
            return o;
          };
    this.fire  = make(new THREE.MeshBasicMaterial(), MAX_FIRE, true);
    this.smoke = make(new THREE.MeshLambertMaterial({ color: 0x5a5550 }), MAX_SMOKE, false);
    this.junk  = make(new THREE.MeshLambertMaterial(), MAX_JUNK, true);
    this.trail = make(new THREE.MeshBasicMaterial(), MAX_TRAIL, true);
  }

  get meshes(): THREE.InstancedMesh[] { return [this.fire, this.smoke, this.junk, this.trail]; }

  get active(): boolean { return ( (this.flames.length + this.puffs.length + this.bits.length + this.trails.length) > 0 ); }

  // An explosion centred at (x, y, z), three.js axes, on ground y.
  // `s` scales how wide it spreads and how big its fire and smoke grow
  // (1 for a blast of radius BURST_RADIUS; a bigger blast radius from an
  // upgrade gives a bigger burst).
  //
  burst(x: number, y: number, z: number, s = 1): void {
    const rnd = (a: number) => ( (Math.random() - 0.5) * a * s ), sz = Math.sqrt(s);
    for (let k = 0; k < 60; k++) {
      if (this.flames.length >= MAX_FIRE) { this.flames.shift(); }
      const a = Math.random() * Math.PI * 2, out = (0.4 + (Math.random() * 1.6)) * s;
      this.flames.push({
        p    : new THREE.Vector3(x + rnd(0.6), y + 0.2 + (Math.random() * 0.4), z + rnd(0.6)),
        v    : new THREE.Vector3(Math.cos(a) * out, 0.8 + (Math.random() * 1.8), Math.sin(a) * out),
        age  : -Math.random() * 0.15,
        life : 0.6 + (Math.random() * 0.6),
        size : (0.1 + (Math.random() * 0.1)) * sz,
        grow : 1.5 + Math.random(),
      });
    }
    for (let k = 0; k < 24; k++) {
      if (this.puffs.length >= MAX_SMOKE) { this.puffs.shift(); }
      this.puffs.push({
        p    : new THREE.Vector3(x + rnd(0.8), y + 0.4 + (Math.random() * 0.4), z + rnd(0.8)),
        v    : new THREE.Vector3(rnd(0.5), 0.35 + (Math.random() * 0.4), rnd(0.5)),
        age  : -(0.2 + (Math.random() * 0.5)),
        life : 1.6 + (Math.random() * 1.2),
        size : (0.15 + (Math.random() * 0.1)) * sz,
        grow : 2 + Math.random(),
      });
    }

    // Junk: thrown up and out all round, a third of each colour.
    //
    for (let k = 0; k < 12; k++) {
      if (this.bits.length >= MAX_JUNK) { this.bits.shift(); }
      const a = ((k / 12) * Math.PI * 2) + rnd(0.4), out = (1.6 + (Math.random() * 2.0)) * s;
      this.bits.push({
        p     : new THREE.Vector3(x + rnd(0.3), y + 0.4, z + rnd(0.3)),
        v     : new THREE.Vector3(Math.cos(a) * out, 3.0 + (Math.random() * 2.5), Math.sin(a) * out),
        r     : new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        spin  : new THREE.Vector3(rnd(20), rnd(20), rnd(20)),
        age   : 0,
        life  : 1.4 + (Math.random() * 0.6),
        size  : 0.09 + (Math.random() * 0.06),
        col   : k % 3,
        emit  : 0,
        floor : y,
      });
    }
  }

  update(dt: number): void {
    const live = (b: { age: number, life: number }) => ((b.age += dt) < b.life);
    this.flames = this.flames.filter(live);
    this.puffs  = this.puffs.filter(live);
    this.trails = this.trails.filter(live);

    // Junk flies on its arc, tumbling, dropping a trail cube every
    // 25 ms; it is gone when it lands or its life ends.
    //
    this.bits = this.bits.filter(b => {
      b.age += dt;
      b.v.y -= 7 * dt;
      b.p.addScaledVector(b.v, dt);
      b.r.x += b.spin.x * dt; b.r.y += b.spin.y * dt; b.r.z += b.spin.z * dt;
      for (b.emit += dt; b.emit >= 0.025; b.emit -= 0.025) {
        if (this.trails.length >= MAX_TRAIL) { this.trails.shift(); }
        this.trails.push({ p: b.p.clone(), age: 0, life: 0.3 + (Math.random() * 0.2), size: b.size * 0.7, col: b.col,
                           rise: ( (b.col === 2) ? 0.3 : 0.6 ) });
      }
      return ( (b.age < b.life) && (b.p.y > b.floor) );
    });

    const put = (o: THREE.InstancedMesh, n: number, p: THREE.Vector3, size: number, c: THREE.Color | null) => {
      const sz = snapSz(size);
      this.s.set(sz, sz, sz);
      this.v.set(snap(p.x), snap(p.y), snap(p.z));
      o.setMatrixAt(n, this.m.compose(this.v, this.q.identity(), this.s));
      if (c) { o.setColorAt(n, c); }
    };
    let n = 0;
    for (const b of this.flames) {
      if (b.age < 0) { continue; }
      b.p.addScaledVector(b.v, dt);
      b.v.multiplyScalar(Math.max(0, 1 - (dt * 3)));
      b.v.y += 0.6 * dt;
      const u = b.age / b.life;
      put(this.fire, n++, b.p, b.size * (1 + (b.grow * u)) * Math.min(1, 4 * (1 - u)), fireColour(u, this.c));
    }
    this.fire.count = n;
    n = 0;
    for (const b of this.puffs) {
      if (b.age < 0) { continue; }
      b.p.addScaledVector(b.v, dt);
      b.v.multiplyScalar(Math.max(0, 1 - (dt * 0.8)));
      const u = b.age / b.life;
      put(this.smoke, n++, b.p, b.size * (1 + (b.grow * u)) * Math.min(1, 3 * (1 - u)) * Math.min(1, 6 * u), null);
    }
    this.smoke.count = n;
    n = 0;
    for (const t of this.trails) {
      t.p.y += t.rise * dt;
      put(this.trail, n++, t.p, t.size * (1 - (t.age / t.life)), STREAM[t.col]);
    }
    this.trail.count = n;

    // Junk keeps its tumble (not snapped), so it reads as thrown pieces.
    //
    this.bits.forEach((b, k) => {
      const sz = snapSz(b.size);
      this.s.set(sz, sz, sz);
      this.junk.setMatrixAt(k, this.m.compose(b.p, this.q.setFromEuler(b.r), this.s));
      this.junk.setColorAt(k, JUNK[b.col]);
    });
    this.junk.count = this.bits.length;
    for (const o of this.meshes) {
      o.instanceMatrix.needsUpdate = true;
      if (o.instanceColor) { o.instanceColor.needsUpdate = true; }
    }
  }
}

// Screen shake: an offset (in cells) t seconds after the derailment,
// jumping about and dying away within about 0.7 s; zero before and
// after.
//
export function shake(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  if ( (t < 0) || (t > 0.8) ) { return out.set(0, 0, 0); }
  const a = 0.22 * Math.exp(-t * 5);
  return out.set(a * Math.sin(t * 71), a * 0.6 * Math.sin((t * 53) + 1.3), a * Math.sin((t * 61) + 2.1));
}
