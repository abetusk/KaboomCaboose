// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Sound effects (2026-11-20, D11b), placed in the level: each plays from
// a point and is louder the nearer that point is to the listener (this
// player's character), half as loud at view.soundHalfCells, and leans to
// the left or right ear by where it is across the view. Web Audio, one
// AudioContext; the browser keeps it silent until the page has been
// clicked or a key pressed (resume()).
//
// Points are in board units: x along the level, y up, z the level's row.
//
// What plays when is config/sounds.json (2026-11-20): per cue, its files
// (one picked at random each time) and its own loudness; checked on load.
//

import raw from "../../config/sounds.json" with { type: "json" };

// The cues the game plays (D11b.1).
//
export const CUES = ["trainStart", "trainRunning", "endWarning", "bump", "built", "crash", "blast", "mine", "chop"] as const;

export type Cue = typeof CUES[number];

export interface CueConfig {
  files  : string[];
  volume : number;
}

export function soundConfig(r: unknown): { folder: string, sounds: Record<Cue, CueConfig> } {
  const c   = r as { folder?: unknown, sounds?: Record<string, { files?: unknown, volume?: unknown }> },
        bad = (m: string): never => { throw new Error("config/sounds.json: " + m); };
  if (typeof c.folder !== "string") { bad("folder must be a string"); }
  const sounds = {} as Record<Cue, CueConfig>;
  for (const cue of CUES) {
    const s = c.sounds?.[cue];
    if (!s) { bad("sounds." + cue + " is missing"); }
    const files = s!.files, volume = s!.volume ?? 1;
    if ( !Array.isArray(files) || !files.length || !files.every(f => ( (typeof f === "string") && (f !== "") )) ) {
      bad("sounds." + cue + ".files must be a list of one or more file names");
    }
    if ( (typeof volume !== "number") || !Number.isFinite(volume) || (volume < 0) ) { bad("sounds." + cue + ".volume must be a number >= 0"); }
    sounds[cue] = { files: files as string[], volume: volume as number };
  }
  for (const k of Object.keys(c.sounds ?? {})) {
    if (!(CUES as readonly string[]).includes(k)) { bad("sounds." + k + " is not a cue (" + CUES.join(", ") + ")"); }
  }
  return { folder: c.folder as string, sounds };
}

export const SOUNDS = soundConfig(raw);


export interface Pt3 {
  x : number;
  y : number;
  z : number;
}

// How far a sound leans to one ear: the full lean PAN_CELLS across the
// view, never quite all in one ear.
//
const PAN_CELLS = 6,
      PAN_MAX   = 0.8;

export interface SoundConfig {
  sound          : boolean;
  soundVolume    : number;
  soundHalfCells : number;
}

// Whether a looping animation that was at `was` and is now at `now`
// (seconds into its clip; less than `was` when it wrapped round) went
// through the moment `at`.
//
export function passed(was: number, now: number, at: number): boolean {
  return ( (was <= now) ? ( (was < at) && (at <= now) ) : ( (was < at) || (at <= now) ) );
}

// One sound playing: moved with its source while it plays, stopped with
// a short fade.
//
export class Voice {
  readonly src  : AudioBufferSourceNode;
  readonly gain : GainNode;
  readonly pan  : StereoPannerNode;
  at    : Pt3;
  level : number;
  ended : boolean;

  constructor(src: AudioBufferSourceNode, gain: GainNode, pan: StereoPannerNode, at: Pt3, level: number) {
    this.src   = src;
    this.gain  = gain;
    this.pan   = pan;
    this.at    = at;
    this.level = level;
    this.ended = false;
    src.onended = () => { this.ended = true; };
  }

  move(at: Pt3): void { this.at = at; }

  // Fade out over `fade` seconds, then end.
  //
  stop(fade = 0.25): void {
    if (this.ended) { return; }
    const t = this.gain.context.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0, t + fade);
    try { this.src.stop(t + fade + 0.02); } catch { }
    this.ended = true;
  }
}

export class Sounds {
  private ctx     : AudioContext | null;
  private buffers : Map<string, AudioBuffer>;
  private voices  : Set<Voice>;
  private cfg     : SoundConfig;

  // The listener, and the view's rightward direction on the board.
  //
  private ear     : Pt3;
  private right   : { x: number, z: number };

  constructor(cfg: SoundConfig) {
    this.cfg     = cfg;
    this.buffers = new Map();
    this.voices  = new Set();
    this.ear     = { x: 0, y: 0, z: 0 };
    this.right   = { x: 1, z: 0 };
    try { this.ctx = new AudioContext(); } catch { this.ctx = null; }
  }

  // Load every file the cues name (SOUNDS); a file that fails to load
  // stays silent.
  //
  async load(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) { return; }
    const names = [...new Set(Object.values(SOUNDS.sounds).flatMap(c => c.files))];
    await Promise.all(names.map(async n => {
      try {
        const r = await fetch(SOUNDS.folder + n);
        this.buffers.set(n, await ctx.decodeAudioData(await r.arrayBuffer()));
      }
      catch (e) {
        console.warn("sound " + n + " not loaded:", e);
      }
    }));
  }

  // Let sound start: browsers keep an AudioContext suspended until the
  // person has interacted with the page.
  //
  resume(): void {
    if ( this.ctx && (this.ctx.state === "suspended") ) { void this.ctx.resume(); }
  }

  listen(ear: Pt3, right: { x: number, z: number }): void {
    this.ear = ear;
    const l = Math.hypot(right.x, right.z);
    this.right = ( (l > 1e-6) ? { x: right.x / l, z: right.z / l } : { x: 1, z: 0 } );
  }

  // Loudness and lean of a sound at `at`, `level` its own loudness.
  //
  private mix(at: Pt3, level: number): [number, number] {
    const dx = at.x - this.ear.x, dy = at.y - this.ear.y, dz = at.z - this.ear.z,
          d  = Math.hypot(dx, dy, dz) / Math.max(1e-3, this.cfg.soundHalfCells),
          g  = ( this.cfg.sound ? ((this.cfg.soundVolume * level) / (1 + (d * d))) : 0 ),
          p  = Math.max(-PAN_MAX, Math.min(PAN_MAX, ((dx * this.right.x) + (dz * this.right.z)) / PAN_CELLS));
    return [g, p];
  }

  // Play one of cue's files, at random, once from `at` (or looped); null
  // if it cannot play. `rate` speeds it up (and raises its pitch).
  //
  play(cue: Cue, at: Pt3, o: { loop?: boolean, rate?: number } = {}): Voice | null {
    const c = SOUNDS.sounds[cue], ctx = this.ctx, buf = this.buffers.get(c.files[Math.floor(Math.random() * c.files.length)]);
    if ( !ctx || !buf || (ctx.state !== "running") ) { return null; }
    const src = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner(),
          level = c.volume, [g, p] = this.mix(at, level);
    src.buffer = buf;
    src.loop   = !!o.loop;
    src.playbackRate.value = o.rate ?? 1;
    gain.gain.value = g;
    pan.pan.value   = p;
    src.connect(gain).connect(pan).connect(ctx.destination);
    src.start();
    const v = new Voice(src, gain, pan, at, level);
    this.voices.add(v);
    return v;
  }

  // Each frame: every sound still playing follows its source and the
  // listener; finished ones are let go.
  //
  update(): void {
    const ctx = this.ctx;
    if (!ctx) { return; }
    for (const v of this.voices) {
      if (v.ended) { this.voices.delete(v); continue; }
      const [g, p] = this.mix(v.at, v.level);
      v.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
      v.pan.pan.setTargetAtTime(p, ctx.currentTime, 0.05);
    }
  }
}
