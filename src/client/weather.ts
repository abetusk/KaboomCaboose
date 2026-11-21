// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Rain and snow (2026-11-20, D11.20), over the levels whose weather it
// is (src/client/climate.ts). Drops and flakes fall over the visible
// window only; each takes the weather of where it starts, so the fall
// thins out across a level's edge. Rain: each drop a short slanted
// staircase of cubes on the voxel grid (2026-11-20: cubes sized in
// terrain voxels, a 32nd of a cell, every cube's place snapped to the
// grid of its size), falling at a slant; some drops make a small ring
// where they land; a few
// ground cells hold a faint, shiny puddle. Snow: small flakes drifting
// down, none settling. All of it is light on purpose.
//
// Board units: x along the level, y up, z the level's row.
//

import * as THREE from "three";
import { Cell } from "../level/cells.ts";
import type { World } from "../sim/world.ts";
import type { Climate } from "./climate.ts";

export interface WeatherConfig {
  weather    : boolean;
  rainDrops  : number;
  snowFlakes : number;
  rainSplash : number;

  // A raindrop's cube on the page and in AR, in terrain voxels (a 32nd
  // of a cell); cubes in a drop, one above another, each `rainSlant`
  // voxels back against the slant; voxels sideways per voxel of fall
  // (2026-11-20).
  //
  rainVoxels      : number;
  arRainVoxels    : number;
  rainStreak      : number;
  rainSlant       : number;

  // How fast rain falls, in cells a second (2026-11-20).
  //
  rainSpeed       : number;
  puddles    : number;
}

// Most drops, cubes to a drop, and flakes drawn at once; where they
// start falling, above the board; snow's fall speed in cells a second
// (rain's is view.rainSpeed); the terrain's voxel, in cells.
//
const MAX_DROPS  = 3000,
      MAX_STREAK = 4,
      MAX_FLAKES = 2000,
      TOP        = 5,
      SNOW_SPEED = 0.9,
      VOXEL      = 1 / 32;

// Splash rings: how many at once, how long one lasts.
//
const SPLASHES   = 160,
      SPLASH_AGE = 0.28;

function hash(i: number): number {
  let x = (i + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ( (x ^ (x >>> 16)) >>> 0 );
}

// One falling thing: place, where it lands, whether it shows (its
// start's weather is its kind), and a phase for snow's drift.
//
interface Faller {
  x     : number;
  y     : number;
  z     : number;
  floor : number;
  on    : boolean;
  phase : number;
}

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(),
      FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export class WeatherView {
  readonly group = new THREE.Group();
  private cfg      : WeatherConfig;
  private rain     : THREE.InstancedMesh;
  private snow     : THREE.InstancedMesh;
  private rings    : THREE.InstancedMesh;
  private pools    : THREE.InstancedMesh | null;
  private drops    : Faller[];
  private flakes   : Faller[];
  private splashes : { x: number, y: number, z: number, age: number }[];
  private next     : number;
  private poolAt   : number[];
  private poolT    : number;
  private climate  : Climate | null;
  private world    : World | null;
  private ground   : (x: number, z: number) => number;
  private time     : number;

  constructor(cfg: WeatherConfig) {
    this.cfg = cfg;
    const unlit = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    this.rain  = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), unlit(0xa8bcd6, 0.75), MAX_DROPS * MAX_STREAK);
    this.snow  = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 0.045, 0.045), unlit(0xf4f6fa, 0.9), MAX_FLAKES);
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.025, 0.04, 12), unlit(0xd0dcea, 0.35), SPLASHES);
    for (const m of [this.rain, this.snow, this.rings]) {
      m.frustumCulled = false;
      m.castShadow    = false;
      m.count         = 0;
      this.group.add(m);
    }
    this.pools    = null;
    this.drops    = [];
    this.flakes   = [];
    this.splashes = [];
    this.next     = 0;
    this.poolAt   = [];
    this.poolT    = 0;
    this.climate  = null;
    this.world    = null;
    this.ground   = () => 0;
    this.time     = 0;
  }

  // A new run's world: its climate, the walking surface's height, and
  // the puddles of its rainy levels.
  //
  setWorld(w: World, climate: Climate, ground: (x: number, z: number) => number): void {
    this.world   = w;
    this.climate = climate;
    this.ground  = ground;
    this.drops   = [];
    this.flakes  = [];
    this.splashes = [];
    if (this.pools) { this.group.remove(this.pools); this.pools.geometry.dispose(); this.pools = null; }
    this.poolAt = [];
    for (let i = 0; i < (w.w * w.h); i++) {
      const [x] = w.xy(i);
      if ( this.puddleCell(w, i) && (climate.at(x, i) === "rain") && ((hash(i + 6151) / 4294967296) < this.cfg.puddles) ) { this.poolAt.push(i); }
    }
    if (!this.poolAt.length) { return; }

    // Puddles: flat, a little uneven in shape, dark and glossy, half see
    // through.
    //
    const mat = new THREE.MeshPhongMaterial({ color: 0x323e4a, specular: 0x9aaabb, shininess: 80, transparent: true, opacity: 0.3, depthWrite: false });
    this.pools = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 18), mat, this.poolAt.length);
    this.pools.frustumCulled = false;
    this.pools.receiveShadow = true;
    this.group.add(this.pools);
    this.placePools();
  }

  private puddleCell(w: World, i: number): boolean {
    return ( (w.type(i) === Cell.GROUND) && !w.track[i] && !w.stack[i] && !w.bridge[i] );
  }

  // Puddles where their cell is still plain ground (track laid or a
  // stack put down hides one).
  //
  private placePools(): void {
    const w = this.world, pools = this.pools;
    if ( !w || !pools ) { return; }
    this.poolAt.forEach((i, k) => {
      const [x, y] = w.xy(i), h = hash(i + 991), jx = (((h & 255) / 255) - 0.5) * 0.3, jz = ((((h >>> 8) & 255) / 255) - 0.5) * 0.3,
            r = 0.17 + ((((h >>> 16) & 255) / 255) * 0.2), e = 0.7 + ((((h >>> 24) & 255) / 255) * 0.5),
            show = this.puddleCell(w, i), cx = x + 0.5 + jx, cz = y + 0.5 + jz;
      M.compose(P.set(cx, this.ground(cx, cz) + 0.006, cz), FLAT, S.set( ( show ? r * e : 0 ), ( show ? r : 0 ), 1 ));
      pools.setMatrixAt(k, M);
    });
    pools.instanceMatrix.needsUpdate = true;
  }

  private start(f: Faller, x0: number, x1: number, kind: "rain" | "snow", anywhere: boolean): void {
    const w = this.world!;
    f.x     = x0 + (Math.random() * (x1 - x0));
    f.z     = Math.random() * w.h;
    f.floor = this.ground(f.x, f.z);
    f.y     = ( anywhere ? (f.floor + (Math.random() * (TOP - f.floor))) : (TOP + (Math.random() * 0.5)) );
    f.on    = ( this.climate!.at(f.x, Math.floor(Math.random() * 1e9)) === kind );
    f.phase = Math.random() * Math.PI * 2;
  }

  // Each frame, over the visible window [x0, x1]; `ar` for AR's cube
  // size.
  //
  update(dt: number, x0: number, x1: number, ar = false): void {
    this.time += dt;
    const w = this.world, c = this.climate, on = ( this.cfg.weather && !!w && !!c && c.any );
    this.group.visible = on;
    if (!on) { return; }

    // Only over the level itself (the window can reach past its ends).
    //
    x0 = Math.max(0, x0);
    x1 = Math.min(w!.w, x1);

    // Puddles follow track and stacks now and then.
    //
    this.poolT += dt;
    if (this.poolT > 0.5) { this.poolT = 0; this.placePools(); }

    const v      = VOXEL * Math.max(1, Math.round( ar ? this.cfg.arRainVoxels : this.cfg.rainVoxels )),
          streak = Math.max(1, Math.min(MAX_STREAK, Math.round(this.cfg.rainStreak))),
          slant  = this.cfg.rainSlant,
          grid   = (u: number) => ( (Math.floor(u / v) + 0.5) * v );
    const fall = (list: Faller[], n: number, kind: "rain" | "snow", mesh: THREE.InstancedMesh) => {
      n = Math.max(0, Math.min(n, ( (kind === "rain") ? MAX_DROPS : MAX_FLAKES )));
      while (list.length < n) {
        const f = { x: 0, y: 0, z: 0, floor: 0, on: false, phase: 0 };
        this.start(f, x0, x1, kind, true);
        list.push(f);
      }
      list.length = n;
      list.forEach((f, k) => {
        if ( (f.x < x0) || (f.x > x1) ) { this.start(f, x0, x1, kind, true); }
        if (kind === "rain") {
          f.y -= this.cfg.rainSpeed * dt;
          f.x += this.cfg.rainSpeed * slant * dt;
        }
        else {
          f.y -= SNOW_SPEED * dt;
          f.x += Math.sin((this.time * 1.1) + f.phase) * 0.25 * dt;
          f.z += Math.cos((this.time * 0.8) + (f.phase * 1.7)) * 0.2 * dt;
        }
        if (f.y <= f.floor) {
          if ( (kind === "rain") && f.on && (Math.random() < this.cfg.rainSplash) ) { this.splash(f.x, f.floor, f.z); }
          this.start(f, x0, x1, kind, false);
        }
        const s = ( f.on ? 1 : 0 );
        if (kind === "snow") {
          M.compose(P.set(f.x, f.y, f.z), Q, S.set(s, s, s));
          mesh.setMatrixAt(k, M);
          return;
        }

        // A drop: `streak` cubes, the lowest leading, each on the grid.
        //
        for (let j = 0; j < streak; j++) {
          M.compose(P.set(grid(f.x - (j * slant * v)), grid(f.y + (j * v)), grid(f.z)), Q, S.set(s * v, s * v, s * v));
          mesh.setMatrixAt((k * streak) + j, M);
        }
      });
      mesh.count = ( (kind === "rain") ? (n * streak) : n );
      mesh.instanceMatrix.needsUpdate = true;
    };
    fall(this.drops, ( c.levels.includes("rain") ? this.cfg.rainDrops : 0 ), "rain", this.rain);
    fall(this.flakes, ( c.levels.includes("snow") ? this.cfg.snowFlakes : 0 ), "snow", this.snow);

    // Splash rings widen and are gone.
    //
    let n = 0;
    for (const s of this.splashes) {
      s.age += dt;
      const live = (s.age < SPLASH_AGE), k = 1 + ((s.age / SPLASH_AGE) * 3);
      M.compose(P.set(s.x, s.y + 0.01, s.z), FLAT, S.set( ( live ? k : 0 ), ( live ? k : 0 ), 1 ));
      this.rings.setMatrixAt(n++, M);
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
  }

  private splash(x: number, y: number, z: number): void {
    if (this.splashes.length < SPLASHES) { this.splashes.push({ x, y, z, age: 0 }); return; }
    const s = this.splashes[this.next];
    s.x = x; s.y = y; s.z = z; s.age = 0;
    this.next = (this.next + 1) % SPLASHES;
  }
}
