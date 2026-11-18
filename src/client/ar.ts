// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// AR mode (D3.2-D3.5): the board on a real table, seen through the
// headset's passthrough (an immersive-ar WebXR session).
//
// Placing: when the session starts the board follows where the viewer
// looks, resting on the real surface there (WebXR hit test), its south
// edge turned to the viewer. It settles once the aim has stayed put for
// a moment (src/client/board.ts `dwell`); a trigger press, a pinch or a
// grab puts it down at once, a grab also starting to move it. Without
// hit test it floats in front of the viewer, below eye level.
// Once placed it is held by a WebXR anchor where the device has them, so
// it stays put as the headset's tracking settles.
//
// Moving: a pinch (hand tracking) or a squeeze (controller grip) grabs.
// One grab drags the level along the board, as a right-button drag pans
// on the page (`pan`, taken by the page each frame). Two grabs carry the
// board, turn it about the vertical and resize it (src/client/board.ts);
// letting go of the second anchors it again.
//

import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { dwell, DWELL_TIME, faceYaw, moveTwo, type BoardPose, type Dwell, type P3 } from "./board.ts";

// Pinch: thumb and index finger tips closer than PINCH_ON metres starts
// a grab, further than PINCH_OFF ends it (the gap stops flicker).
//
const PINCH_ON  = 0.02,
      PINCH_OFF = 0.04;

type Hand = "left" | "right";

export class ArBoard {
  renderer : THREE.WebGLRenderer;
  board    : THREE.Group;
  pose     : BoardPose;
  placed   : boolean;
  pads     : Record<Hand, Gamepad | null>;

  // Viewer position and look direction in room space, from the last
  // frame.
  //
  head     : P3;
  look     : P3;
  reticle  : THREE.Mesh;

  private hitSource : XRHitTestSource | null;
  private anchor    : XRAnchor | null;
  private anchorDue : boolean;
  private pinching  : Set<XRInputSource>;
  private grabIds   : XRInputSource[];
  private grabFrom  : { pose: BoardPose, pts: P3[] } | null;
  private twoHands  : boolean;
  private panLast   : number | null;
  private pan       : number;
  private aim       : Dwell;
  private hitLast   : boolean;
  private tLast     : number;

  // cellSize: metres per cell when the board is first placed.
  //
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, board: THREE.Group, cellSize: () => number,
              onStart: () => void, onEnd: () => void) {
    this.renderer  = renderer;
    this.board     = board;
    this.pose      = { x: 0, y: 0, z: 0, yaw: 0, scale: 1 };
    this.placed    = false;
    this.pads      = { left: null, right: null };
    this.head      = { x: 0, y: 0, z: 0 };
    this.look      = { x: 0, y: 0, z: -1 };
    this.hitSource = null;
    this.anchor    = null;
    this.anchorDue = false;
    this.pinching  = new Set();
    this.grabIds   = [];
    this.grabFrom  = null;
    this.twoHands  = false;
    this.panLast   = null;
    this.pan       = 0;
    this.aim       = { at: null, t: 0 };
    this.hitLast   = false;
    this.tLast     = 0;

    // A ring on the surface where the board will go.
    //
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.04, 0.05, 32).rotateX(-Math.PI / 2),
                                  new THREE.MeshBasicMaterial({ color: 0xf0c040 }));
    this.reticle.visible = false;
    scene.add(this.reticle);

    renderer.xr.enabled = true;
    renderer.xr.addEventListener("sessionstart", async () => {
      const s = renderer.xr.getSession()!;
      this.placed = false;
      this.pose   = { x: 0, y: 0, z: 0, yaw: 0, scale: cellSize() };
      this.aim    = { at: null, t: 0 };
      this.tLast  = performance.now();
      s.addEventListener("select", () => { if (!this.placed) { this.place(); } });
      onStart();
      try {
        const viewer = await s.requestReferenceSpace("viewer");
        this.hitSource = (await s.requestHitTestSource?.({ space: viewer })) ?? null;
      }
      catch { this.hitSource = null; }
    });
    renderer.xr.addEventListener("sessionend", () => {
      this.hitSource?.cancel();
      this.anchor?.delete();
      this.hitSource = null;
      this.anchor    = null;
      this.anchorDue = false;
      this.pinching.clear();
      this.grabIds   = [];
      this.grabFrom  = null;
      this.twoHands  = false;
      this.panLast   = null;
      this.pan       = 0;
      this.pads      = { left: null, right: null };
      this.reticle.visible = false;
      board.position.set(0, 0, 0);
      board.rotation.set(0, 0, 0);
      board.scale.setScalar(1);
      onEnd();
    });
  }

  // The page's "START AR" button (three.js ARButton). Hit test, anchors
  // and hand tracking are asked for but not required.
  //
  button(): HTMLElement {
    return ARButton.createButton(this.renderer, { optionalFeatures: ["hit-test", "anchors", "hand-tracking"] });
  }

  get active(): boolean { return this.renderer.xr.isPresenting; }

  place(): void {
    this.placed    = true;
    this.anchorDue = true;
    this.reticle.visible = false;
  }

  // Once per frame while in AR, before input is read and the board drawn.
  //
  update(frame: XRFrame | undefined): void {
    this.pads = { left: null, right: null };
    if ( !this.active || !frame ) { return; }
    const ref = this.renderer.xr.getReferenceSpace();
    if (!ref) { return; }
    const vp = frame.getViewerPose(ref);
    if (vp) {
      const p = vp.transform.position, o = vp.transform.orientation,
            f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w));
      this.head = { x: p.x, y: p.y, z: p.z };
      this.look = { x: f.x, y: f.y, z: f.z };
    }

    // Controllers (for the game's input) and grab points.
    //
    const pts: [XRInputSource, P3][] = [];
    for (const src of frame.session.inputSources) {
      if (src.hand) {
        const pinch = this.pinch(frame, ref, src);
        if (pinch) { pts.push([src, pinch]); }
        continue;
      }
      if ( src.gamepad && ( (src.handedness === "left") || (src.handedness === "right") ) ) { this.pads[src.handedness] = src.gamepad; }
      if (src.gamepad?.buttons[1]?.pressed) {
        const g = frame.getPose(src.gripSpace ?? src.targetRaySpace, ref);
        if (g) { pts.push([src, { x: g.transform.position.x, y: g.transform.position.y, z: g.transform.position.z }]); }
      }
    }

    // A grab while placing puts the board down where it is and goes on as
    // a grab, so the same squeeze or pinch can carry it on.
    //
    const now = performance.now(), dt = Math.min(0.1, (now - this.tLast) / 1000);
    this.tLast = now;
    if ( !this.placed && (pts.length > 0) ) { this.place(); }
    if (!this.placed) { this.follow(frame, ref, dt); }
    else              { this.grab(frame, ref, pts); }
    this.apply();
  }

  // Midpoint of thumb and index tips while the hand pinches.
  //
  private pinch(frame: XRFrame, ref: XRReferenceSpace, src: XRInputSource): P3 | null {
    const th = src.hand!.get("thumb-tip"), ix = src.hand!.get("index-finger-tip"),
          a  = ( (th && frame.getJointPose) ? frame.getJointPose(th, ref) : undefined ),
          b  = ( (ix && frame.getJointPose) ? frame.getJointPose(ix, ref) : undefined );
    if ( !a || !b ) { this.pinching.delete(src); return null; }
    const p = a.transform.position, q = b.transform.position,
          d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    if      (d < PINCH_ON)  { this.pinching.add(src); }
    else if (d > PINCH_OFF) { this.pinching.delete(src); }
    return ( this.pinching.has(src) ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z + q.z) / 2 } : null );
  }

  // Before placing: rest on the surface the viewer looks at, or float in
  // front of the viewer; settle once the aim holds still. Switching
  // between a surface and floating starts the wait again.
  //
  private follow(frame: XRFrame, ref: XRReferenceSpace, dt: number): void {
    let at: P3 | null = null;
    if (this.hitSource) {
      const hit = frame.getHitTestResults(this.hitSource)[0], p = hit?.getPose(ref);
      if (p) { at = { x: p.transform.position.x, y: p.transform.position.y, z: p.transform.position.z }; }
    }
    if ( (at !== null) !== this.hitLast ) { this.aim = { at: null, t: 0 }; }
    this.hitLast = (at !== null);
    if (!at) {
      const fl = Math.hypot(this.look.x, this.look.z), fx = ( (fl > 1e-3) ? (this.look.x / fl) : 0 ), fz = ( (fl > 1e-3) ? (this.look.z / fl) : -1 );
      at = { x: this.head.x + (fx * 0.6), y: this.head.y - 0.45, z: this.head.z + (fz * 0.6) };
    }
    this.pose = { ...this.pose, x: at.x, y: at.y, z: at.z, yaw: faceYaw(at, this.head) };
    this.reticle.visible = true;
    this.reticle.position.set(at.x, at.y, at.z);

    // The ring widens as the wait to settle runs, so holding still shows.
    //
    this.reticle.scale.setScalar(1 + this.settling);
    if (dwell(this.aim, at, dt)) { this.place(); }
  }

  // While placing, how far along the wait to settle is (0 to 1).
  //
  get settling(): number { return ( this.placed ? 1 : Math.min(1, this.aim.t / DWELL_TIME) ); }

  // How far the level has been dragged along the board (board x, in
  // cells) since the last call.
  //
  takePan(): number {
    const d = this.pan;
    this.pan = 0;
    return d;
  }

  // A room point's x in the board's own axes, in cells.
  //
  private boardX(p: P3): number {
    const b = this.pose;
    return ( (((p.x - b.x) * Math.cos(b.yaw)) - ((p.z - b.z) * Math.sin(b.yaw))) / b.scale );
  }

  // After placing: one grab drags the level, two move the board; the
  // anchor holds the board otherwise.
  //
  private grab(frame: XRFrame, ref: XRReferenceSpace, pts: [XRInputSource, P3][]): void {
    const ids  = pts.map(([s]) => s),
          two  = (pts.length >= 2),
          same = ( (ids.length === this.grabIds.length) && ids.every((s, k) => (s === this.grabIds[k])) );
    if (!same) {
      if ( two && !this.twoHands ) { this.anchor?.delete(); this.anchor = null; }
      if ( !two && this.twoHands ) { this.anchorDue = true; }
      this.grabIds  = ids;
      this.grabFrom = ( ids.length ? { pose: { ...this.pose }, pts: pts.map(([, p]) => p) } : null );
      this.panLast  = ( (pts.length === 1) ? this.boardX(pts[0][1]) : null );
    }
    this.twoHands = two;
    const g = this.grabFrom;
    if ( g && two ) { this.pose = moveTwo(g.pose, g.pts[0], g.pts[1], pts[0][1], pts[1][1]); }
    else if ( (pts.length === 1) && (this.panLast !== null) ) {
      const x = this.boardX(pts[0][1]);
      this.pan    += x - this.panLast;
      this.panLast = x;
    }

    // A new anchor where the board now rests; once tracked, the board
    // follows it.
    //
    if ( this.anchorDue && frame.createAnchor ) {
      this.anchorDue = false;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.pose.yaw);
      frame.createAnchor(new XRRigidTransform({ x: this.pose.x, y: this.pose.y, z: this.pose.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), ref)
        ?.then(a => {
          if (this.twoHands) { a.delete(); return; }
          this.anchor = a;
        })
        .catch(() => { });
    }
    if ( this.anchor && !this.twoHands ) {
      const p = frame.getPose(this.anchor.anchorSpace, ref);
      if (p) {
        const t = p.transform, e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w), "YXZ");
        this.pose = { ...this.pose, x: t.position.x, y: t.position.y, z: t.position.z, yaw: e.y };
      }
    }
  }

  private apply(): void {
    this.board.position.set(this.pose.x, this.pose.y, this.pose.z);
    this.board.rotation.set(0, this.pose.yaw, 0);
    this.board.scale.setScalar(this.pose.scale);
  }

  // The viewer's look direction across the board, in the board's own
  // axes (level x along three.js x, level y along z), flattened.
  //
  lookOnBoard(): { x: number, z: number } {
    const c = Math.cos(this.pose.yaw), s = Math.sin(this.pose.yaw),
          x = (this.look.x * c) - (this.look.z * s),
          z = (this.look.x * s) + (this.look.z * c),
          l = Math.hypot(x, z);
    return ( (l > 1e-3) ? { x: x / l, z: z / l } : { x: 0, z: -1 } );
  }
}

// A line of text drawn on a sprite: names, emotes and messages in AR,
// where the page's HTML overlays are not shown.
//
export class Tag {
  sprite : THREE.Sprite;
  height : number;
  private canvas : HTMLCanvasElement;
  private tex    : THREE.CanvasTexture;
  private text   : string;

  // height: the text's height in board units (cells).
  //
  constructor(height: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width  = 512;
    this.canvas.height = 64;
    this.tex    = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthWrite: false, transparent: true }));
    this.sprite.renderOrder = 5;
    this.sprite.visible = false;
    this.height = height;
    this.text   = "";
  }

  set(text: string, colour = "#ffffff"): void {
    this.sprite.visible = (text !== "");
    if (text === this.text) { return; }
    this.text = text;
    const g = this.canvas.getContext("2d");
    if (!g) { return; }
    g.font = "600 40px system-ui, sans-serif";
    const w = Math.min(2048, Math.ceil(g.measureText(text).width) + 24);
    if (w !== this.canvas.width) { this.canvas.width = w; }
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.fillStyle = "rgba(0, 0, 0, 0.55)";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.font = "600 40px system-ui, sans-serif";
    g.fillStyle = colour;
    g.textBaseline = "middle";
    g.fillText(text, 12, 34);
    this.tex.dispose();
    this.tex.needsUpdate = true;
    this.sprite.scale.set(this.height * (this.canvas.width / this.canvas.height), this.height, 1);
  }
}
