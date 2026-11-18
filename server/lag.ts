// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Made-up network delay for testing (D7.7): one Lag per client per
// direction holds each message for `latency` ms plus a random 0 to
// `jitter` ms, and lets them out in the order they came in, as a
// WebSocket (over TCP) delivers them. With both at 0 messages pass at
// once, as without it.
//

export class Lag {
  latency : number;
  jitter  : number;
  private rnd   : () => number;
  private q     : { at: number, f: () => void }[];
  private timer : ReturnType<typeof setTimeout> | null;
  private last  : number;

  constructor(latency: number, jitter: number, rnd: () => number = Math.random) {
    this.latency = Math.max(0, latency);
    this.jitter  = Math.max(0, jitter);
    this.rnd     = rnd;
    this.q       = [];
    this.timer   = null;
    this.last    = 0;
  }

  // Runs f once its delay has passed, never before anything queued
  // earlier, so jitter delays but does not reorder.
  //
  run(f: () => void): void {
    if ( (this.latency <= 0) && (this.jitter <= 0) ) { f(); return; }
    const at = Math.max(this.last, performance.now() + this.latency + (this.rnd() * this.jitter));
    this.last = at;
    this.q.push({ at, f });
    if (!this.timer) { this.arm(); }
  }

  // Drops what is still held (the connection has gone).
  //
  clear(): void {
    if (this.timer) { clearTimeout(this.timer); }
    this.timer = null;
    this.q     = [];
  }

  private arm(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = performance.now();
      while ( (this.q.length > 0) && (this.q[0].at <= (now + 0.5)) ) { this.q.shift()!.f(); }
      if (this.q.length > 0) { this.arm(); }
    }, Math.max(0, this.q[0].at - performance.now()));
  }
}
