// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Birds (2026-11-20, D11.21): small flocks over the visible window, page
// side only (each viewer sees their own). A flock comes in from one side
// high up and either crosses and leaves, or circles a while; a circling
// flock then often lands, each bird on its own spot on a tree, a grey
// rock or the ground nearby, where it bobs and turns now and then. A
// perched flock takes off when something happens near it: a block hit or
// broken, a blast, a crash, a character or the train coming close; or
// after a while on its own. Flocks that have left come back after a
// pause.
//
// A bird is a dark body and two wings, drawn as three instanced meshes
// for every bird at once. Board units: x along the level, y up, z the
// level's row.
//

import * as THREE from "three";

export interface BirdConfig {
  birds         : boolean;
  birdFlocks    : number;
  birdsPerFlock : number;
}

// What the flocks need from the level, for the window [x0, x1].
//
export interface BirdWorld {
  x0    : number;
  x1    : number;
  depth : number;

  // Where a bird could stand in cell (x, z): the height, or null (water,
  // off the level).
  //
  perch : (x: number, z: number) => number | null;

  // Whether a character or the train is within r cells of (x, z).
  //
  near  : (x: number, z: number, r: number) => boolean;
}

const MAX_BIRDS = 160;

// Heights of flight, speeds (cells a second), how near a disturbance
// scares a perched or landing flock (cells), and how near characters or
// the train may come.
//
const HIGH       = [3.2, 4.6],
      CRUISE     = [2.4, 3.4],
      SCARE      = 3.5,
      SHY        = 1.3;

type Mode = "away" | "cross" | "circle" | "land" | "perched" | "flee";

interface Bird {
  off   : THREE.Vector3;
  p     : THREE.Vector3;
  v     : THREE.Vector3;
  spot  : THREE.Vector3 | null;
  down  : boolean;
  flap  : number;
  rate  : number;
  yaw   : number;
  hop   : number;
}

interface Flock {
  mode   : Mode;
  t      : number;
  until  : number;
  c      : THREE.Vector3;
  v      : THREE.Vector3;
  circle : { x: number, z: number, y: number, r: number, a: number, w: number };
  willCircle : boolean;
  birds  : Bird[];
}

const rand  = (lo: number, hi: number) => ( lo + (Math.random() * (hi - lo)) );
const M = new THREE.Matrix4(), W = new THREE.Matrix4(), R = new THREE.Matrix4(), Q = new THREE.Quaternion(),
      S = new THREE.Vector3(1.4, 1.4, 1.4), E = new THREE.Euler(), UP = new THREE.Vector3(0, 1, 0);

export class Birds {
  readonly group = new THREE.Group();
  private cfg    : BirdConfig;
  private body   : THREE.InstancedMesh;
  private wingL  : THREE.InstancedMesh;
  private wingR  : THREE.InstancedMesh;
  private flocks : Flock[];
  private shocks : THREE.Vector3[];

  constructor(cfg: BirdConfig) {
    this.cfg = cfg;
    const mat  = new THREE.MeshLambertMaterial({ color: 0x2c2a30 }),
          wing = new THREE.BoxGeometry(0.07, 0.008, 0.15).translate(0, 0, 0.075);
    this.body  = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.05, 0.055), mat, MAX_BIRDS);
    this.wingL = new THREE.InstancedMesh(wing, mat, MAX_BIRDS);
    this.wingR = new THREE.InstancedMesh(wing, mat, MAX_BIRDS);
    for (const m of [this.body, this.wingL, this.wingR]) {
      m.frustumCulled = false;
      m.castShadow    = true;
      m.count         = 0;
      this.group.add(m);
    }
    this.flocks = [];
    this.shocks = [];
  }

  // Something happened at (x, y, z): flocks perched or landing near it
  // take off.
  //
  disturb(x: number, y: number, z: number): void { this.shocks.push(new THREE.Vector3(x, y, z)); }

  // A new level: every flock away, coming back after a short pause.
  //
  reset(): void {
    for (const f of this.flocks) { this.leave(f, 1, 6); }
  }

  private leave(f: Flock, lo: number, hi: number): void {
    f.mode  = "away";
    f.t     = 0;
    f.until = rand(lo, hi);
  }

  private makeFlock(): Flock {
    const f: Flock = { mode: "away", t: 0, until: rand(0.5, 6), c: new THREE.Vector3(), v: new THREE.Vector3(),
                       circle: { x: 0, z: 0, y: 0, r: 0, a: 0, w: 0 }, willCircle: false, birds: [] };
    return f;
  }

  // A flock comes in from beyond one side of the window, high, in a loose
  // V-ish spread.
  //
  private arrive(f: Flock, bw: BirdWorld, n: number): void {
    const west = (Math.random() < 0.5), speed = rand(CRUISE[0], CRUISE[1]);
    f.mode = "cross";
    f.t    = 0;
    f.c.set( ( west ? (bw.x0 - 4) : (bw.x1 + 4) ), rand(HIGH[0], HIGH[1]), rand(-1, bw.depth + 1) );
    f.v.set( ( west ? speed : -speed ), 0, rand(-0.4, 0.4) );
    f.willCircle = (Math.random() < 0.75);
    f.birds = Array.from({ length: n }, (_, k) => {
      const row = Math.ceil(k / 2), side = ( ((k % 2) === 0) ? 1 : -1 ),
            off = new THREE.Vector3(-0.35 * row + rand(-0.1, 0.1), rand(-0.15, 0.15), side * 0.3 * row + rand(-0.1, 0.1));
      return { off, p: f.c.clone().add(off), v: f.v.clone(), spot: null, down: false, flap: Math.random() * 6, rate: rand(11, 15),
               yaw: 0, hop: rand(1, 4) };
    });
  }

  // A spot for each bird around a cell a flock lands on: a cell in the
  // window that something can stand on, away from characters and the
  // train; null if none found.
  //
  private landing(f: Flock, bw: BirdWorld): boolean {
    for (let tries = 0; tries < 30; tries++) {
      const x = Math.floor(rand(bw.x0 + 1, bw.x1 - 1)), z = Math.floor(rand(0, bw.depth));
      if ( (bw.perch(x, z) === null) || bw.near(x + 0.5, z + 0.5, SHY + 1) ) { continue; }
      for (const b of f.birds) {
        let spot: THREE.Vector3 | null = null;
        for (let k = 0; ( (k < 8) && !spot ); k++) {
          const sx = x + rand(-0.6, 1.6), sz = z + rand(-0.6, 1.6), h = bw.perch(Math.floor(sx), Math.floor(sz));
          if (h !== null) { spot = new THREE.Vector3(sx, h, sz); }
        }
        b.spot = spot ?? new THREE.Vector3(x + 0.5, bw.perch(x, z)!, z + 0.5);
        b.down = false;
      }
      return true;
    }
    return false;
  }

  private flee(f: Flock, from: THREE.Vector3): void {
    f.mode = "flee";
    f.t    = 0;
    const away = new THREE.Vector3(f.c.x - from.x, 0, f.c.z - from.z);
    if (away.lengthSq() < 1e-4) { away.set(rand(-1, 1), 0, rand(-1, 1)); }
    away.normalize();
    f.v.set(away.x * 3.5, 0, away.z * 1.5);
    if (Math.abs(f.v.x) < 1.5) { f.v.x = ( (f.v.x >= 0) ? 1.5 : -1.5 ); }
    for (const b of f.birds) {
      b.down = false;
      b.spot = null;
      b.v.set(away.x * 2 + rand(-0.5, 0.5), rand(2.5, 3.5), away.z * 2 + rand(-0.5, 0.5));
    }
  }

  update(dt: number, bw: BirdWorld): void {
    const on = this.cfg.birds;
    this.group.visible = on;
    const want = ( on ? Math.max(0, Math.round(this.cfg.birdFlocks)) : 0 ),
          per  = Math.max(1, Math.min(Math.round(this.cfg.birdsPerFlock), Math.floor(MAX_BIRDS / Math.max(1, want))));
    while (this.flocks.length < want) { this.flocks.push(this.makeFlock()); }
    this.flocks.length = want;
    const shocks = this.shocks;
    this.shocks = [];

    for (const f of this.flocks) {
      f.t += dt;
      if (f.mode === "away") {
        if (f.t >= f.until) { this.arrive(f, bw, per); }
        continue;
      }
      const mid = (bw.x0 + bw.x1) / 2;

      // Startled: anything near a flock that is on the ground or coming
      // down, or a character or the train close to one of its birds.
      //
      if ( (f.mode === "perched") || (f.mode === "land") ) {
        const s = shocks.find(q => f.birds.some(b => (b.p.distanceTo(q) < SCARE)));
        const b = f.birds.find(b => ( b.down && bw.near(b.p.x, b.p.z, SHY) ));
        if (s)      { this.flee(f, s); }
        else if (b) { this.flee(f, b.p); }
      }

      if (f.mode === "cross") {
        f.c.addScaledVector(f.v, dt);
        f.c.y += (rand(HIGH[0], HIGH[1]) - f.c.y) * 0.2 * dt;
        if ( f.willCircle && (Math.abs(f.c.x - mid) < 3) ) {
          f.mode = "circle";
          f.t    = 0;
          f.until = rand(6, 12);
          const r = rand(1.8, 3.4);
          f.circle = { x: f.c.x, z: Math.max(r * 0.5, Math.min(bw.depth - (r * 0.5), f.c.z)), y: rand(2.6, 3.8), r,
                       a: rand(0, Math.PI * 2), w: ( (Math.random() < 0.5) ? 0.7 : -0.7 ) };
        }
        if ( (f.c.x < (bw.x0 - 9)) || (f.c.x > (bw.x1 + 9)) ) { this.leave(f, 4, 20); continue; }
      }
      else if (f.mode === "circle") {
        const k = f.circle;
        k.a += k.w * dt;
        const goal = new THREE.Vector3(k.x + (Math.cos(k.a) * k.r), k.y, k.z + (Math.sin(k.a) * k.r * 0.6));
        f.c.lerp(goal, 1 - Math.exp(-dt * 2));
        if (f.t >= f.until) {
          if ( (Math.random() < 0.65) && this.landing(f, bw) ) { f.mode = "land"; f.t = 0; }
          else {
            f.mode = "cross";
            f.willCircle = false;
            f.v.set( ( (Math.random() < 0.5) ? 1 : -1 ) * rand(CRUISE[0], CRUISE[1]), 0, rand(-0.3, 0.3) );
          }
        }
      }
      else if (f.mode === "land") {
        if ( f.birds.every(b => b.down) || (f.t > 8) ) { f.mode = "perched"; f.t = 0; f.until = rand(8, 22); }
      }
      else if (f.mode === "perched") {
        if (f.t >= f.until) { this.flee(f, f.c.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)))); }
      }
      else if (f.mode === "flee") {
        f.c.addScaledVector(f.v, dt);
        if (f.t > 1.2) {
          f.mode = "cross";
          f.willCircle = false;
          f.v.y = 0;
        }
      }

      // Each bird: in the air it keeps its place in the flock, loosely;
      // landing it flies to its own spot and settles; on the ground it
      // bobs and turns now and then.
      //
      const flockYaw = Math.atan2(-f.v.z, f.v.x);
      let cx = 0, cy = 0, cz = 0;
      for (const b of f.birds) {
        if (b.down) {
          b.v.set(0, 0, 0);
          b.hop -= dt;
          if (b.hop <= 0) { b.hop = rand(1, 4); b.yaw += rand(-1.5, 1.5); }
        }
        else if ( (f.mode === "land") && b.spot ) {
          const d = b.spot.clone().sub(b.p), dist = d.length();
          if (dist < 0.04) { b.p.copy(b.spot); b.down = true; }
          else {
            const sp = Math.min(3, dist * 2.2 + 0.4);
            b.v.lerp(d.multiplyScalar(sp / dist), 1 - Math.exp(-dt * 4));
            b.p.addScaledVector(b.v, dt);
          }
        }
        else if (f.mode === "flee") {
          b.v.y -= 1.5 * dt;
          b.v.lerp(f.v, 1 - Math.exp(-dt * 1.5));
          b.p.addScaledVector(b.v, dt);
        }
        else {
          const goal = f.c.clone().add(b.off.clone().applyAxisAngle(UP, flockYaw))
                          .add(new THREE.Vector3(0, Math.sin((f.t * 1.3) + b.rate) * 0.12, 0)),
                was  = b.p.clone();
          b.p.lerp(goal, 1 - Math.exp(-dt * 2.5));
          b.v.copy(b.p).sub(was).divideScalar(Math.max(dt, 1e-3));
        }
        if (!b.down) {
          const flat = Math.hypot(b.v.x, b.v.z);
          if (flat > 0.05) { b.yaw = Math.atan2(-b.v.z, b.v.x); }
        }
        cx += b.p.x; cy += b.p.y; cz += b.p.z;
      }
      if ( (f.mode === "land") || (f.mode === "perched") ) { f.c.set(cx / f.birds.length, cy / f.birds.length, cz / f.birds.length); }
    }
    this.draw(dt);
  }

  // Bodies along their heading; wings beat in the air (gliding now and
  // then while circling) and fold on the ground.
  //
  private draw(dt: number): void {
    let n = 0;
    for (const f of this.flocks) {
      if (f.mode === "away") { continue; }
      for (const b of f.birds) {
        if (n >= MAX_BIRDS) { break; }
        const glide = ( (f.mode === "circle") && (Math.sin((f.t * 0.9) + b.rate) > 0.4) );
        b.flap += dt * b.rate;
        const wing = ( b.down ? -1.2 : ( glide ? -0.15 : (Math.sin(b.flap) * 0.9) ) ),
              bob  = ( b.down ? (Math.max(0, Math.sin(b.hop * 9)) * 0.02) : 0 );
        Q.setFromEuler(E.set(0, b.yaw, ( b.down ? 0 : Math.max(-0.4, Math.min(0.4, b.v.y * 0.15)) )));
        M.compose(new THREE.Vector3(b.p.x, b.p.y + 0.03 + bob, b.p.z), Q, S);
        this.body.setMatrixAt(n, M);
        W.makeRotationX(-wing);
        this.wingL.setMatrixAt(n, R.multiplyMatrices(M, W));
        W.makeRotationX(-wing).premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
        this.wingR.setMatrixAt(n, R.multiplyMatrices(M, W));
        n++;
      }
    }
    for (const m of [this.body, this.wingL, this.wingR]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}
