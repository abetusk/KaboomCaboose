// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Small seeded PRNG (mulberry32) so every level is reproducible
// from its seed.
//
export class Rng {
  s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Integer in [lo, hi], inclusive.
  //
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * ((hi - lo) + 1));
  }

  chance(p: number): boolean {
    return (this.next() < p);
  }
}
