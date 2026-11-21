// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The browser client: connects to the server, draws the level, the
// train and the characters, and sends this player's input. The server
// runs the game (D7.2); this page only draws what it is sent. On a
// headset it also offers AR mode, the board on a real table (D3.2).
//

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CONFIG, DOCS } from "../config.ts";
import { Cell, DIRS, isRamp } from "../level/cells.ts";
import { World, Item, ITEM_NAMES, wagonOf } from "../sim/world.ts";
import { carPose } from "../sim/path.ts";
import { Game, CARS, CAR_LEN, WHEELBASE, PAD_RADIUS, TAP, throwPower, Tool, TOOL_NAMES, trainBody, type Input, type Train, type Pad, type Plan, type Offer } from "../sim/game.ts";
import { launch, stepBomb, flight, type Bomb } from "../sim/dynamite.ts";
import { EMOTES, SHARED_SECTIONS, type ServerMsg, type State, type PlayerView, type ClientMsg, type RoomInfo, type LobbyPad } from "../net/protocol.ts";
import { Lobby } from "./lobby.ts";
import { UPGRADES, OFFERS_PER_STATION, upgrade } from "../upgrades.ts";
import { loadVox, voxGeometry, type Vox } from "./voxel.ts";
import { Terrain, topY, yawFor, curveYaw, TRACK_PILE, itemScale, TERRAIN_VIEW_KEYS, type Models } from "./terrain.ts";
import { Controls, loadBindings } from "./input.ts";
import { Chips } from "./chips.ts";
import { Puffs } from "./puffs.ts";
import { Blast, BURST_RADIUS, shake } from "./blast.ts";
import { Predictor, Interp } from "./netsync.ts";
import { handTool } from "./handtools.ts";
import { characterGear, carGear, characterOffer, toolGear, blockText, GLOW } from "./gear.ts";
import { ArBoard } from "./ar.ts";
import { VoxText, GOLD, RED as RED_TEXT, type TextLine } from "./voxtext.ts";
import { drawable } from "./voxfont.ts";
import { Sounds, passed, type Voice, type Pt3 } from "./sound.ts";
import { Climate } from "./climate.ts";
import { WeatherView } from "./weather.ts";
import { Birds } from "./birds.ts";
import { BRICK_PALETTE, BRICK_CRACK } from "../assets/bricks.ts";

const GEN = "assets/generated/", KY = "assets/third_party/kytric/";

async function loadModels(): Promise<{ m: Models, loco: Vox, wagons: Vox[], house: Vox }> {
  const v = (f: string) => loadVox(f);
  const r4 = (f: (k: number) => string) => Promise.all([0, 1, 2, 3].map(k => v(f(k))));
  const n = (pre: string, k: number) => Promise.all(Array.from({ length: k }, (_, j) => v(GEN + pre + j + ".vox")));
  const [groundDetail, blackStrata, boulders, crags, pebbles, flowers, leaves, gravel, bush, vine, sideStone, grassFringe] = await Promise.all([
    n("ground-detail-", 4), n("black-strata-", 4),
    Promise.all([0, 1, 2].map(s => Promise.all([0, 1, 2, 3].map(j => v(GEN + "boulder-" + j + "-s" + s + ".vox"))))),
    n("crag-", 6), n("pebbles-", 3), n("flowers-", 3), n("leaves-", 3), n("gravel-", 3), n("bush-", 3),
    n("vine-", 3), n("side-stone-", 3), n("grass-fringe-", 3),
  ]);
  const json = <J>(f: string, none: J): Promise<J> => fetch(GEN + f).then(r => ( r.ok ? r.json() : none )).catch(() => none);
  const [carvedRelief, carvedJson, brickJson, rockJson] = await Promise.all([
    n("carved-relief-", 8), json("carved-blocks.json", { blocks: [] }), json("rock-bricks.json", { tile: "" }),
    json("rock-relief.json", { heights: [1, 3, 3, 1], border: 1, chip: 0, variants: 0 }),
  ]);

  const [ground, forest, black, ramp, bridge, water, rock, trees, items, grass, rest] = await Promise.all([
    r4(k => GEN + "ground-" + k + ".vox"),
    r4(k => GEN + "forest-floor-" + k + ".vox"),
    r4(k => GEN + "black-rock-" + k + ".vox"),
    r4(k => GEN + "ramp-" + k + ".vox"),
    r4(k => GEN + "bridge-" + k + ".vox"),
    Promise.all([0, 1].map(k => v(GEN + "water-" + k + ".vox"))),
    Promise.all([0, 1, 2, 3].map(k => r4(s => GEN + "grey-rock-" + k + "-s" + s + ".vox"))),
    Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(k => v(KY + "tree-" + k + ".vox"))),
    Promise.all(["item-wood-0", "item-wood-1", "item-ore-0", "item-ore-1"].map(n => v(GEN + n + ".vox"))),
    Promise.all([0, 1, 2, 3, 4, 5].map(k => v(GEN + "grass-" + k + ".vox"))),

    // Train (D6a.13): locomotive v3; storage wagon (wood and ore go in)
    // v8; crafting wagon (track comes out) v6.
    //
    Promise.all([GEN + "stump-0.vox", GEN + "track-straight-0.vox", GEN + "track-curve-0.vox", GEN + "track-ramp-0.vox",
                 GEN + "train-v3-x2.vox", GEN + "train-trailer-v8-x2.vox", GEN + "train-trailer-v6-x2.vox",
                 GEN + "station-house.vox"].map(v)),
  ]);
  const [stump, straight, curve, slope, loco, storage, crafting, house] = rest;
  return {
    m: { ground, forest, black, water: [...water, ...water], rock, ramp, bridge, trees, stump, straight, curve, slope,
         wood: items.slice(0, 2), ore: items.slice(2, 4), grass,
         groundDetail, blackStrata, boulders, crags, pebbles, flowers, leaves, gravel, bush, vine, sideStone, grassFringe,
         carved: carvedJson.blocks as string[], carvedRelief, bricks: brickJson.tile as string,
         rockTiles: (brickJson as { tiles?: string[] }).tiles ?? [], rockCarve: rockJson },
    loco, wagons: [storage, crafting], house,
  };
}

// ---- page ----

const hud   = document.getElementById("hud")!,
      setBody = document.getElementById("settingsBody")!;

// The game server is where the page came from, under the page's own
// folder: at https://example.com/rail/ the connection is
// wss://example.com/rail/ws, so a web server can pass any path on to the
// game (docs/DEPLOY.md). ?server=HOST:PORT names another server, at its
// root.
//
const params  = new URL(location.href).searchParams,
      other   = params.get("server"),
      base    = ( other ? new URL(location.protocol + "//" + other + "/") : new URL(".", location.href) ),
      wsUrl   = new URL("ws", base).href.replace(/^http/, "ws"),
      urlName = params.get("name") ?? ("player" + Math.floor(Math.random() * 1000));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene  = new THREE.Scene(),
      SKY    = new THREE.Color(0xa8c8e8);
scene.background = SKY;

// All game content sits under one node (D3.5). `content` holds the level
// in its own units (cells; level x is three.js x, level y is z); `board`
// puts it on the table in AR and is left alone on the desktop.
//
const board = new THREE.Group(), content = new THREE.Group();
board.add(content);
scene.add(board);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 400);
scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 1.2));
// The sun casts shadows over a square around the view centre, moved with
// it each frame (so ledges and props read at any camera angle). It shines
// from the north-west, where pixel-art tiles put their light (lit edges
// top-left), so painted and cast shading agree (D11.13).
//
const SUN_DIR = new THREE.Vector3(-0.45, 1, -0.35).normalize();
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
sun.shadow.camera.top  = 18;  sun.shadow.camera.bottom = -18;
sun.shadow.camera.near = 1;   sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
content.add(sun, sun.target);
let shadowScale = 1;

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI * 0.45;
orbit.enablePan = true;
orbit.screenSpacePanning = false;

// Bloom (view.bloom): bright parts of the picture glow. The scene is
// drawn into a multisampled half-float target (so edges stay smooth and
// brightness above 1 survives), bloomed, then converted for the screen.
//
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 })),
      bloom    = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0, 0, 1);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Frame timing for the read-out: frames per second (smoothed); the
// page's own work per frame in ms (game code, and handing the scene to
// WebGL; the graphics card's work is not in it); draw calls and
// triangles over all passes; and the WebGL renderer the browser uses
// ("llvmpipe", "softpipe" or "SwiftShader" mean drawing in software,
// slow whatever the page does).
//
renderer.info.autoReset = false;
const perf = { fps: 0, js: 0, start: 0, gpu: glRenderer() };

function glRenderer(): string {
  try {
    const gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter( ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER ));
  }
  catch { return "unknown"; }
}

function perfLine(): string {
  const r = renderer.info.render;
  return ( perf.fps.toFixed(0) + " fps   page " + perf.js.toFixed(1) + " ms a frame   " + r.calls + " draw calls   " +
           (r.triangles / 1000).toFixed(0) + "k triangles   WebGL: " + perf.gpu );
}

function framed(dt: number): void {
  perf.js  = (perf.js * 0.9) + ((performance.now() - perf.start) * 0.1);
  perf.fps = (perf.fps * 0.95) + ((1 / Math.max(dt, 1e-3)) * 0.05);
}

function draw(): void {
  const v = CONFIG.view;

  // The headset draws each eye itself; bloom works only on the page.
  //
  if ( !v.bloom || renderer.xr.isPresenting ) { renderer.render(scene, camera); return; }
  bloom.strength  = v.bloomStrength;
  bloom.radius    = v.bloomRadius;
  bloom.threshold = v.bloomThreshold;
  composer.render();
}

addEventListener("resize", () => {
  if (renderer.xr.isPresenting) { return; }
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// Clip everything outside the window around the camera's centre
// (D2.1, D2.2).
//
const clipW = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
      clipE = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
      AXIS_E = new THREE.Vector3(1, 0, 0), AXIS_W = new THREE.Vector3(-1, 0, 0);
renderer.clippingPlanes = [clipW, clipE];

// AR mode (D3.2-D3.5, src/client/ar.ts). In AR the passthrough shows
// instead of the sky, and text over characters is drawn as sprites
// (the page's HTML is not shown in the headset). arCentre is the level x
// at the middle of the board; arPan is how far a one-hand drag has moved
// it off what the camera mode follows.
//
// The frame timer stops counting while the page is hidden; a headset
// browser may count the page as hidden during the session, so in AR the
// timer ignores page visibility. The headset takes its near and far
// drawing limits from the page camera: in AR they are set in metres, so
// a board seen from a few centimetres is not cut away.
//
let arOn = false, arCentre = 0, arPan = 0;
// Sound effects (2026-11-20, D11b; src/client/sound.ts). The browser
// lets them start only after a click, a key or a touch on the page.
//
// What plays when is config/sounds.json.
//
const sounds = new Sounds(CONFIG.view);
void sounds.load();
for (const ev of ["pointerdown", "keydown", "touchstart"]) { addEventListener(ev, () => sounds.resume()); }

// Rain, snow and birds (D11.20, D11.21), added to the board once it
// exists.
//
const weather = new WeatherView(CONFIG.view),
      birds   = new Birds(CONFIG.view);
content.add(weather.group, birds.group);

// The room's seed (Welcome.seed), so everyone in the room gets the same
// weather; what the weather was last made for.
//
let runSeed = 1, climateKey = "", weatherWorld: World | null = null;

// The train's chug and each character's mining or chopping, while they
// play; when the horn last sounded.
//
let chug: Voice | null = null, hornAt = -1e9;
const chops = new Map<number, Voice>();

// Every sound that follows the game stops (leaving a room, a new level).
//
// The swing animation, and how far through it the pick strikes (the arm
// stops coming down at about 0.23 s of its 0.42 s).
//
const SWING        = "attack-melee-right",
      SWING_STRIKE = 0.56;

function mineStrike(id: number): void {
  const at = avatarAt(id);
  if (!at) { return; }
  const v = sounds.play("mine", at);
  if (v) { chops.set(id, v); }
}

function hush(): void {
  chug?.stop();
  chug = null;
  for (const v of chops.values()) { v.stop(); }
  chops.clear();
}

function arMode(on: boolean): void {
  arOn = on;
  scene.background = ( on ? null : SKY );
  camera.near = ( on ? 0.01 : 0.1 );
  camera.far  = ( on ? 20 : 400 );
  camera.updateProjectionMatrix();
  if (on) { arCentre = orbit.target.x; arPan = 0; timer.disconnect(); sounds.resume(); }
  else    { content.position.set(0, 0, 0); timer.connect(document); }

  // AR started from the HTML lobby goes into the walk-in lobby; AR ended
  // there goes back to the HTML lobby (2026-11-20).
  //
  if      ( on && !roomInfo && !asked ) { lobby.hide(); toWalkIn(); }
  else if ( !on && roomInfo?.lobby )    { say({ t: "leave" }); toLobby(); }
}
const ar = new ArBoard(renderer, scene, board, () => CONFIG.view.arCellSize, () => arMode(true), () => arMode(false));
navigator.xr?.isSessionSupported("immersive-ar")
  .then(ok => { if (ok) { document.body.appendChild(ar.button()); } })
  .catch(() => { });
// Messages in blocks (2026-11-19; src/client/voxtext.ts): the level-end
// message and the AR placing hint over the middle of the board, the
// seconds until the train leaves over the start pad, and the emote menu
// as an oval of words around this player's character, a little toward
// the viewer, each word where the stick or keys point to pick it (up
// first, then clockwise, as Controls.sector counts).
//
const msgText   = new VoxText(0.075),
      leaveText = new VoxText(0.1, GOLD),
      menuRing  = new THREE.Group(),
      menuWords = EMOTES.map(() => new VoxText(0.04)),
      MENU_RX   = 1.1,
      MENU_RY   = 0.85;
menuWords.forEach(t => menuRing.add(t.group));

// ---- state ----

let world: World | null = null,
    terrain: Terrain | null = null,
    myId = -1,
    last: State | null = null,
    line: number[] = [];

// Hiding network delay (D7.4). `world` is what is drawn: the server's
// world (`truth`) with this player's own inputs not yet confirmed
// applied on top (pred), so moves, pickups, presses, tool changes and
// hits show at once and the server's answer corrects them. `shown` is
// what the terrain was last told, to spot real changes. Others and the
// train are drawn a little in the past between server states (interp).
//
let pred: Predictor | null = null,
    truth: World | null = null,
    shown: World | null = null;
const interp = new Interp();

// Hit and break feedback already shown, so a prediction redone after a
// server state does not repeat it: per cell, the most hits shown, and
// the cells shown felled or broken.
//
const fedHits = new Map<number, number>(), fedBroke = new Set<number>();

// After this player's prediction or a server state changed the drawn
// world: rebuild what really changed, with chop and mine feedback for
// new hits and breaks.
//
function syncShown(): void {
  if ( !world || !shown || !terrain ) { return; }
  let any = false;
  for (const i of world.changed) {
    if (world.sameCell(shown, i)) { continue; }
    const wasTree = (shown.type(i) === Cell.TREE), wasRock = (shown.type(i) === Cell.ROCK),
          broke   = ( (wasTree || wasRock) && (world.type(i) !== shown.type(i)) ),
          hit     = ( (wasTree || wasRock) && !broke && (world.hits[i] > (fedHits.get(i) ?? shown.hits[i])) );
    if ( broke && !fedBroke.has(i) ) {
      fedBroke.add(i);
      if (wasTree) { treeFeedback(world, terrain, i, true); } else { rockFeedback(world, terrain, i, true); }
    }
    else if (hit) {
      fedHits.set(i, world.hits[i]);
      if (wasTree) { treeFeedback(world, terrain, i, false); } else { rockFeedback(world, terrain, i, false); }
    }
    shown.copyCell(world, i);
    terrain.touch(i);
    any = true;
  }
  world.changed.clear();
  if (any) { line = world.line(); groundWagonsKey = ""; }
}

// Wagons lying on the ground (D6.7), drawn whole at a little under car
// size; found again whenever the drawn world changes.
//
const groundWagons = new THREE.Group();
let groundWagonsKey = "-";

function drawGroundWagons(w: World): void {
  if (groundWagonsKey !== "") { return; }
  groundWagonsKey = "done";
  groundWagons.clear();
  for (let i = 0; i < w.stack.length; i++) {
    const kind = wagonOf(w.stack[i]);
    if (!kind) { continue; }
    const [x, y] = w.xy(i), o = carMesh(kind);
    o.scale.setScalar(CONFIG.view.trainScale * 0.9);
    o.position.set(x + 0.5, topY(w.standZ(i)), y + 0.5);
    o.castShadow = true;
    groundWagons.add(o);
  }
}

// This player's own state as predicted, over what the server last said:
// what is carried, the tool, hitting, boosting, refusals and emotes
// show at once.
//
function own(p: PlayerView): PlayerView {
  const me = pred?.me;
  if ( (p.id !== myId) || !me ) { return p; }
  return { ...p, carry: me.carry, count: me.count, tool: me.tool, hitting: me.hitting, boosting: (me.boostT > 0),
           denied: (me.denyT > 0), emote: ( (me.emoteT > 0) ? me.emote : -1 ), dead: ( p.dead || (me.dead > 0) ),
           fuse: me.fuse, aimT: me.aimT };
}

const models = await loadModels();

const vmat   = new THREE.MeshLambertMaterial({ vertexColors: true });
const geoOf  = new Map<Vox, THREE.BufferGeometry>();
const vmesh  = (m: Vox) => {
  let g = geoOf.get(m);
  if (!g) { g = voxGeometry(m, true); geoOf.set(m, g); }
  return new THREE.Mesh(g, vmat);
};

// Characters (D11a.2): one glTF per kind, cloned per player.
//
const gltfs = new Map<string, GLTF>();
await Promise.all(["knight", "zombie", "robot"].map(async c => {
  gltfs.set(c, await new GLTFLoader().loadAsync("assets/third_party/kenney/character-" + c + ".glb"));
}));

interface Avatar {
  character : string;
  root    : THREE.Group;
  mixer   : THREE.AnimationMixer;
  actions : Map<string, THREE.AnimationAction>;
  current : string;
  hands   : THREE.Group;
  handKey : string;
  over    : VoxText;
  tools   : THREE.Group[];
  boosted : boolean;
  gear    : THREE.Object3D[];
  gearKey : string;
  edge    : THREE.Group;
  x       : number;
  y       : number;
  h       : number;
  moving  : number;
  yaw     : number;

  // Where the swing animation was last frame (seconds into its clip;
  // -1 not swinging), to catch the pick's strike.
  //
  swingT  : number;
}
const avatars = new Map<number, Avatar>();

// A player's name in blocks (2026-11-19), smaller than the messages over
// it. Characters the voxel font lacks are left out; a name with none it
// has shows as "?".
//
const NAME_SCALE = 0.7;

function shownName(name: string): string {
  const t = [...name].filter(ch => drawable(ch)).join("").trim();
  return ( t || "?" );
}

function dropAvatar(id: number): void {
  const a = avatars.get(id);
  if (!a) { return; }
  content.remove(a.root, a.edge);
  a.over.dispose();
  avatars.delete(id);
  chops.get(id)?.stop();
  chops.delete(id);
}

function makeAvatar(p: PlayerView): Avatar {
  const g = gltfs.get(p.character) ?? gltfs.get("knight")!,
        model = cloneSkinned(g.scene) as THREE.Group,
        root = new THREE.Group(), mixer = new THREE.AnimationMixer(model),
        actions = new Map<string, THREE.AnimationAction>();
  root.add(model);
  model.traverse(o => { o.castShadow = true; });
  for (const clip of g.animations) { actions.set(clip.name, mixer.clipAction(clip)); }
  const hands = new THREE.Group();
  hands.position.set(0, 0.32, 0.28);
  root.add(hands);
  content.add(root);
  const over = new VoxText(0.05);
  content.add(over.group);

  // The pickaxe and the axe, held on the right arm (D11a.4); shown by
  // the tool the player holds.
  //
  const arm = model.getObjectByName("arm-right") ?? root,
        tools = [handTool("pick"), handTool("axe")];
  for (const t of tools) { t.visible = false; arm.add(t); }
  const edge = edgeMarker(p.id === myId);
  content.add(edge);
  return { character: p.character, root, mixer, actions, current: "", hands, handKey: "", over, tools, boosted: p.boosting, gear: [], gearKey: "", edge, x: p.x, y: p.y, h: 0, moving: 0, swingT: -1,
           yaw: Math.atan2(Math.cos(p.heading), Math.sin(p.heading)) };
}

function play(a: Avatar, name: string): void {
  if (a.current === name) { return; }
  const next = a.actions.get(name);
  if (!next) { return; }
  const prev = a.actions.get(a.current);
  next.reset();
  if (name === "die") { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
  next.play();
  if (prev) { prev.crossFadeTo(next, 0.15, false); }
  a.current = name;
}

// Train cars (D6a.13).
//
// The train's cars follow its own list (wagons join at stations, D6.7):
// one mesh per car, made again when the list changes, each with a group
// on top for its load.
//
const CAR_MODELS: Record<string, Vox> = { locomotive: models.loco, storage: models.wagons[0], crafting: models.wagons[1], dynamite: models.wagons[0] };

// The dynamite wagon is the storage wagon's model in red.
//
const DYN_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, color: new THREE.Color(2.4, 0.45, 0.35) });

function carMesh(kind: string): THREE.Mesh {
  const o = vmesh(CAR_MODELS[kind] ?? models.wagons[0]);
  if (kind === "dynamite") { o.material = DYN_MAT; }
  return o;
}
let cars: THREE.Object3D[] = [], cargo: THREE.Group[] = [], carsKey = "";

// The upgrades taken this run, as the server last said (D6.7).
//
function taken(): Record<string, number> { return ( last?.taken ?? {} ); }

// Made again when the cars, the upgrades taken or a stick's cost change;
// each car carries what its upgrades look like (src/client/gear.ts).
//
function makeCars(kinds: string[]): void {
  const tk = taken(), cost: [number, number] = [CONFIG.rules.dynamiteWood, CONFIG.rules.dynamiteOre],
        key = kinds.join(",") + ":" + JSON.stringify(tk) + ":" + cost.join(",");
  if (key === carsKey) { return; }
  carsKey = key;
  for (const o of cars) { content.remove(o); }
  cars  = kinds.map(k => {
    const o = carMesh(k), m = CAR_MODELS[k] ?? models.wagons[0],
          gear = carGear(k, { length: m.sx / 32, width: m.sy / 32, height: m.sz / 32 }, tk, cost);
    if (gear) { o.add(gear); }
    o.castShadow = true; o.receiveShadow = true; content.add(o);
    return o;
  });
  cargo = cars.map(o => { const g = new THREE.Group(); g.position.y = models.loco.sz / 32; o.add(g); return g; });
  cargoKey = "";
}

const stationProps = new THREE.Group();
content.add(stationProps, groundWagons);

// The start pad (D6.9): a dark shadow circle on the ground, a pie that
// fills while someone stands in it, and START in block letters floating
// above.
//
const padGroup = new THREE.Group(),
      padShadow = new THREE.Mesh(new THREE.CircleGeometry(PAD_RADIUS, 40),
                                 new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })),
      padFillMat = new THREE.MeshBasicMaterial({ color: 0xf0c040, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
      padFill = new THREE.Mesh(new THREE.CircleGeometry(PAD_RADIUS * 0.9, 40, 0, 0.001), padFillMat),
      padIcon = new THREE.Group();
padShadow.rotation.x = -Math.PI / 2;
padFill.rotation.x = -Math.PI / 2;
padFill.position.y = 0.005;
padGroup.add(padShadow, padFill, padIcon);
content.add(padGroup, msgText.group, leaveText.group, menuRing);
let padShown = -1;

// Above the pad, START in block letters (2026-11-18), about 1.5 cells
// wide, facing south (toward the usual view), standing still.
//
const START_PX = 0.08, START_MAT = new THREE.MeshLambertMaterial({ color: 0xf0c040, emissive: 0x604000 });

function drawPad(pad: Pad, phase: string, w: World, time: number): void {
  const on = (phase === "ready");
  padGroup.visible = on;
  if (!on) { return; }
  const y = standY(w, pad.x, pad.y);
  padGroup.position.set(pad.x, y + 0.01, pad.y);
  const f = Math.min(1, pad.progress / CONFIG.station.dwellSeconds);
  if (Math.abs(f - padShown) > 1e-3) {
    padShown = f;
    padFill.geometry.dispose();
    const len = Math.max(0.001, f * Math.PI * 2);
    padFill.geometry = new THREE.CircleGeometry(PAD_RADIUS * 0.9, 40, (Math.PI / 2) - len, len);
  }
  if (!padIcon.children.length) {
    const [text] = blockText("START", START_PX, START_MAT, 1.5);
    text.traverse(o => { o.castShadow = true; });
    padIcon.add(text);
  }
  padIcon.position.y = 0.9 + (0.06 * Math.sin(time * 2));
}

// Station upgrades on offer (D6.7): circles like the start pad, a
// picture of the upgrade floating above each (offerIcon), a pie that
// fills while someone stands in it, and a label with the setting's value
// now and after.
//
interface OfferView {
  group : THREE.Group;
  fill  : THREE.Mesh;
  icon  : THREE.Group;
  kind  : string;
  shown : number;
}

// The picture of an upgrade, with no words (2026-11-18), big enough to
// read from afar: carry shows the pack and walk speed the wings, with one
// bundle or feather more than now, glowing (src/client/gear.ts); a wagon shows the
// wagon as it would join; a wagon upgrade shows the wagon it changes,
// with the parts it adds glowing gold (one more board, stake pair or
// chimney band, or the lowered dynamite cost).
//
// Sizes of the offer pictures: wagons about 2 cells long, the pack and
// the wings about 1 cell.
//
const OFFER_CAR_SCALE = 1.3, OFFER_GEAR_SCALE = 4;

const OFFER_CAR: Record<string, string> = { storage: "storage", track: "crafting", craft: "crafting", cheapDynamite: "dynamite", blast: "dynamite" };

function offerIcon(kind: string): THREE.Group {
  const g = new THREE.Group(), u = upgrade(kind), tk = taken(),
        cost: [number, number] = [CONFIG.rules.dynamiteWood, CONFIG.rules.dynamiteOre],
        car = (k: string, t: Record<string, number>, c: [number, number], glow: string) => {
          const o = carMesh(k), m = CAR_MODELS[k] ?? models.wagons[0],
                gear = carGear(k, { length: m.sx / 32, width: m.sy / 32, height: m.sz / 32 }, t, c, glow);
          if (gear) { o.add(gear); }
          o.scale.setScalar(OFFER_CAR_SCALE);
          g.add(o);
        };
  const body = characterOffer(kind, tk);
  if (body) {
    body.scale.setScalar(OFFER_GEAR_SCALE);
    g.add(body);
  }
  else if (u?.wagon) { car(u.wagon, tk, cost, ""); }
  else if (OFFER_CAR[kind]) {
    const more = { ...tk, [kind]: (tk[kind] ?? 0) + 1 },
          d    = Object.fromEntries((u?.changes ?? []).map(([, key, v]) => [key, v])) as Record<string, number>,
          c2: [number, number] = [cost[0] + (d.dynamiteWood ?? 0), cost[1] + (d.dynamiteOre ?? 0)];
    car(OFFER_CAR[kind], more, c2, kind);
  }
  else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), GLOW));
  }
  g.traverse(o => { o.castShadow = true; });
  return g;
}

const offerViews: OfferView[] = [];
for (let k = 0; k < OFFERS_PER_STATION; k++) {
  const group  = new THREE.Group(),
        shadow = new THREE.Mesh(new THREE.CircleGeometry(PAD_RADIUS, 40), padShadow.material),
        fill   = new THREE.Mesh(new THREE.CircleGeometry(PAD_RADIUS * 0.9, 40, 0, 0.001), padFillMat),
        icon   = new THREE.Group();
  shadow.rotation.x = -Math.PI / 2;
  fill.rotation.x   = -Math.PI / 2;
  fill.position.y   = 0.005;
  group.add(shadow, fill, icon);
  group.visible = false;
  content.add(group);
  offerViews.push({ group, fill, icon, kind: "", shown: -1 });
}

function drawOffers(offers: Offer[], w: World, time: number): void {
  offerViews.forEach((v, k) => {
    const o = offers[k];
    v.group.visible = !!o;
    if (!o) { return; }
    const y = standY(w, o.x, o.y);
    v.group.position.set(o.x, y + 0.01, o.y);
    const key = o.kind + ":" + JSON.stringify(taken()) + ":" + CONFIG.rules.dynamiteWood;
    if (v.kind !== key) {
      v.kind = key;
      v.icon.clear();
      v.icon.add(offerIcon(o.kind));
    }
    v.icon.position.y = 0.9 + (0.1 * Math.sin((time * 2) + k));
    v.icon.rotation.y = (time * 0.6) + k;
    const f = Math.min(1, o.progress / CONFIG.station.dwellSeconds);
    if (Math.abs(f - v.shown) > 1e-3) {
      v.shown = f;
      v.fill.geometry.dispose();
      const len = Math.max(0.001, f * Math.PI * 2);
      v.fill.geometry = new THREE.CircleGeometry(PAD_RADIUS * 0.9, 40, (Math.PI / 2) - len, len);
    }
  });

  // The added parts glow in and out.
  //
  GLOW.emissiveIntensity = 0.45 + (0.35 * Math.sin(time * 4));
}

// The walk-in lobby's circles (2026-11-20; server/lobby.ts): like the
// start pad, a shadow circle with a pie that fills while someone stands
// in it, and over it its words in blocks. A character circle has that
// character standing on it, turning slowly, its name gold once it is
// this player's.
//
interface LobbyView {
  group : THREE.Group;
  fill  : THREE.Mesh;
  model : THREE.Object3D | null;
  text  : VoxText;
  shown : number;
}

const lobbyViews = new Map<string, LobbyView>();

function lobbyView(pad: LobbyPad): LobbyView {
  const group = new THREE.Group(),
        shadow = new THREE.Mesh(padShadow.geometry, padShadow.material),
        fill   = new THREE.Mesh(new THREE.CircleGeometry(PAD_RADIUS * 0.9, 40, 0, 0.001), padFillMat),
        text   = new VoxText(0.055);
  shadow.rotation.x = -Math.PI / 2;
  fill.rotation.x   = -Math.PI / 2;
  fill.position.y   = 0.005;
  group.add(shadow, fill, text.group);
  let model: THREE.Object3D | null = null;
  if (pad.kind === "character") {
    model = cloneSkinned((gltfs.get(pad.value) ?? gltfs.get("knight")!).scene);
    model.traverse(o => { o.castShadow = true; });
    group.add(model);
  }
  content.add(group);
  return { group, fill, model, text, shown: -1 };
}

function drawLobby(pads: LobbyPad[], w: World, time: number): void {
  const keep = new Set<string>(), mine = last?.players.find(p => (p.id === myId))?.character ?? "";
  for (const pad of pads) {
    const key = pad.kind + ":" + pad.value;
    keep.add(key);
    let v = lobbyViews.get(key);
    if (!v) { v = lobbyView(pad); lobbyViews.set(key, v); }
    v.group.position.set(pad.x, standY(w, pad.x, pad.y) + 0.01, pad.y);
    if (v.model) { v.model.rotation.y = time * 0.6; }
    v.text.set(pad.label.map(l => ({ parts: [{ text: l, colour: ( ( (pad.kind === "character") && (pad.value === mine) ) ? GOLD : undefined ) }] })));
    v.text.group.position.y = ( v.model ? 1.25 : 0.7 );
    const f = Math.min(1, pad.progress / CONFIG.station.dwellSeconds);
    if (Math.abs(f - v.shown) > 1e-3) {
      v.shown = f;
      v.fill.geometry.dispose();
      const len = Math.max(0.001, f * Math.PI * 2);
      v.fill.geometry = new THREE.CircleGeometry(PAD_RADIUS * 0.9, 40, (Math.PI / 2) - len, len);
    }
  }
  for (const [key, v] of lobbyViews) {
    if (keep.has(key)) { continue; }
    v.text.dispose();
    v.fill.geometry.dispose();
    content.remove(v.group);
    lobbyViews.delete(key);
  }
}

// Height of the walking surface at a point (ramps slope).
//
function standY(w: World, x: number, y: number): number {
  const cx = Math.floor(x), cy = Math.floor(y);
  if (!w.inside(cx, cy)) { return 0.5; }
  const i = w.idx(cx, cy);
  let z = w.standZ(i);
  if (isRamp(w.type(i))) {
    const d = w.g.dir[i], fx = x - cx, fy = y - cy,
          u = ( (d === 1) ? fx : ( (d === 3) ? (1 - fx) : ( (d === 2) ? fy : (1 - fy) ) ) );
    z += Math.max(0, Math.min(1, u));
  }
  return topY(z);
}

// Mining feedback (D11.16): stone chips when grey rock is hit, a bigger
// burst with dust when it breaks, in the rock's colours and tint.
//
const chips = new Chips();
content.add(chips.mesh);

// Boost puff (D2.10).
//
const puffs = new Puffs();
content.add(puffs.mesh);

// Derailment (D11.18): fire, smoke and debris at the front of the train
// and a short shake of the view. derailT is when it happened (timer
// seconds), -1 for none; lastPhase spots the change.
//
const blast = new Blast(), shakeOff = new THREE.Vector3(), boomShake = new THREE.Vector3();
content.add(...blast.meshes);
let derailT = -1, lastPhase = "";

function derail(w: World, t: Train, now: number): void {
  const cp = carPose(w, line, t.p - (CAR_LEN / 2), WHEELBASE), f = cp.front, y = topY(f.z) + RAIL_TOP;
  blast.burst(f.x, y, f.y);
  birds.disturb(f.x, y, f.y);
  chips.burst(f.x, y + 0.4, f.y, 30, 2.2, [new THREE.Color(0x2e2e30), new THREE.Color(0x5a5a5e), new THREE.Color(2.0, 0.6, 0.1)], topY(f.z), 0.08);
  derailT = now;
}

// Dynamite (D6.12). A stick is a red block with a spark at one end, lit
// once its fuse burns. Sticks on the ground or in the air come from the
// server's states and are moved on here between them with the same
// steps the server runs, so they fly smoothly. A blast throws fire,
// smoke and stone (the derailment's effects, smaller) and shakes the
// view; the trees and rock it clears break as when chopped or mined.
//
const STICK_MAT = new THREE.MeshLambertMaterial({ color: 0xc8262a }),
      SPARK_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.6, 0.4) }),
      STICK_GEO = new THREE.BoxGeometry(0.32, 0.09, 0.09),
      SPARK_GEO = new THREE.BoxGeometry(0.07, 0.07, 0.07);

function stickMesh(): THREE.Group {
  const g = new THREE.Group(), body = new THREE.Mesh(STICK_GEO, STICK_MAT), spark = new THREE.Mesh(SPARK_GEO, SPARK_MAT);
  body.castShadow = true;
  spark.position.x = 0.18;
  spark.name = "spark";
  g.add(body, spark);
  return g;
}

// Each stick on the ground or in the air shows its fuse's whole seconds
// left in blocks (2026-11-19).
//
const bombGroup = new THREE.Group(), bombTexts = [] as VoxText[];
content.add(bombGroup);
let shownBombs: Bomb[] = [], boomT = -1;

function drawBombs(w: World, dt: number, now: number): void {
  while (bombGroup.children.length < shownBombs.length) {
    const t = new VoxText(0.05, RED_TEXT);
    bombGroup.add(stickMesh());
    content.add(t.group);
    bombTexts.push(t);
  }
  bombGroup.children.forEach((o, k) => {
    const b = shownBombs[k], t = bombTexts[k];
    o.visible = !!b;
    if (!b) { t.set([]); return; }
    stepBomb(w, b, dt);
    b.fuse -= dt;
    t.set([String(Math.ceil(Math.max(0, b.fuse)))]);
    t.group.position.set(b.x, b.z + 0.35, b.y);
    o.position.set(b.x, b.z + 0.05, b.y);
    o.rotation.y = b.id;
    if (!b.rest) { o.rotation.z = now * 9; }
    const spark = o.getObjectByName("spark");
    if (spark) { spark.visible = (Math.sin(now * 40) > -0.3); }
  });
}

function boom(x: number, y: number, z: number, now: number): void {
  const s = Math.max(0.5, CONFIG.rules.blastRadius / BURST_RADIUS);
  blast.burst(x, z, y, s);
  birds.disturb(x, z, y);
  chips.burst(x, z + 0.3, y, 30, 2.6 * s, [new THREE.Color(0x5a5a5e), new THREE.Color(0x6b4a2b), new THREE.Color(2.0, 0.7, 0.15)], z, 0.08);
  boomT = now;
}

// While aiming a throw: the stick's path as dots, and the blast's reach
// where it comes to rest, from the same steps the server will run.
//
const AIM_DOTS = 60,
      aimDots  = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffe080 }), AIM_DOTS),
      aimRing  = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40),
                                new THREE.MeshBasicMaterial({ color: 0xff6040, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })),
      aimM     = new THREE.Matrix4();
aimDots.frustumCulled = false;
aimRing.rotation.x = -Math.PI / 2;
content.add(aimDots, aimRing);

// The throw distance set by the AR controller's tilt (Input.aim), -1
// outside AR; read each frame.
//
let aimNow = -1;

function readAim(): void {
  const hand = controls.cfg.xr.action[0] as "left" | "right", tilt = ( ar.active ? ar.pitch[hand] : null ),
        [lo, hi] = controls.cfg.throwPitch;
  aimNow = ( (tilt === null) ? -1 : Math.max(0, Math.min(1, (tilt - lo) / (hi - lo))) );
}

function drawAim(w: World): void {
  const me = pred?.me;
  aimDots.count = 0;
  aimRing.visible = false;
  if ( !me || (me.carry !== Item.DYNAMITE) || (me.fuse < 0) || (me.aimT < TAP) || (me.dead > 0) ) { return; }
  const r = CONFIG.rules, power = throwPower(me.aimT, aimNow, r),
        path = flight(w, launch(w, 0, me.x, me.y, me.heading, power, r.throwRange, 0), 0.04, 4),
        n = Math.min(AIM_DOTS, path.length);
  for (let k = 0; k < n; k++) {
    const q = path[Math.floor((k * (path.length - 1)) / Math.max(1, n - 1))];
    aimDots.setMatrixAt(k, aimM.makeTranslation(q.x, q.z + 0.05, q.y));
  }
  aimDots.count = n;
  aimDots.instanceMatrix.needsUpdate = true;
  const end = path[path.length - 1];
  aimRing.visible = true;
  aimRing.position.set(end.x, end.z + 0.04, end.y);
  aimRing.scale.setScalar(r.blastRadius);
}

function rockFeedback(w: World, t: Terrain, i: number, broke: boolean): void {
  const [x, y] = w.xy(i), base = topY(w.z(i)), rt = t.rockTint(i) ?? [1, 1, 1],
        cols = [BRICK_PALETTE[1], BRICK_PALETTE[2], BRICK_PALETTE[1], BRICK_CRACK].map(h => {
          const c = new THREE.Color(h);
          return new THREE.Color(c.r * rt[0], c.g * rt[1], c.b * rt[2]);
        });
  birds.disturb(x + 0.5, base, y + 0.5);
  if (!broke) { chips.burst(x + 0.5, base + 0.45, y + 0.5, 10, 1.2, cols, base); return; }
  chips.burst(x + 0.5, base + 0.25, y + 0.5, 36, 1.8, cols, base);
  chips.burst(x + 0.5, base + 0.1, y + 0.5, 14, 0.5, [new THREE.Color(BRICK_PALETTE[2])], base, 0.13);
}

// Chopping feedback (D11.16): each hit on a tree throws flakes of bark
// and pale fresh-cut wood and a few leaves that drift down; felling the
// last tree throws a bigger burst. Colours from the tree models (Kytric's
// leaf green and bark brown) with the tree's tint.
//
const BARK = "#884c2f", CUT = "#d9b27c", LEAF = "#00761e", LEAF_LIT = "#2f9a3c";

function treeFeedback(w: World, t: Terrain, i: number, felled: boolean): void {
  const [x, y] = w.xy(i), base = topY(w.z(i)), tt = t.treeTint(i) ?? [1, 1, 1],
        tint = (h: string) => { const c = new THREE.Color(h); return new THREE.Color(c.r * tt[0], c.g * tt[1], c.b * tt[2]); },
        wood = [tint(BARK), new THREE.Color(CUT), tint(BARK), new THREE.Color(CUT)],
        leaf = [tint(LEAF), tint(LEAF_LIT)];
  const n = ( felled ? 2.5 : 1 );
  birds.disturb(x + 0.5, base, y + 0.5);
  chips.burst(x + 0.5, base + 0.3, y + 0.5, Math.round(9 * n), 1.3, wood, base, 0.07, { flat: 0.35 });
  chips.burst(x + 0.5, base + 0.75, y + 0.5, Math.round(6 * n), 0.7, leaf, base, 0.09, { flat: 0.15, gravity: 2.2, drag: 2.5, life: 1.0 });
}

function setupLevel(msg: Extract<ServerMsg, { t: "welcome" }>): void {
  hush();
  runSeed = msg.seed;
  birds.reset();
  if (terrain) { content.remove(terrain.group); }
  const copy = () => {
    const w = World.fromData(msg.level);
    for (const c of msg.cells) { w.applyCell(c); }
    w.setSegment(msg.seg);
    return w;
  };
  world = copy();
  truth = copy();
  shown = copy();
  fedHits.clear();
  fedBroke.clear();
  groundWagonsKey = "";
  terrain = new Terrain(world, models.m);
  terrain.carveMs = 6;

  // Build around the start station first; the rest of a run follows over
  // the next frames (Terrain.update).
  //
  const sx = world.start[0][0], half = ( arOn ? CONFIG.view.arWindowCells : CONFIG.view.windowCells ) / 2;
  terrain.setWindow(sx - half, sx + half);
  content.add(terrain.group);
  line = world.line();
  myId = msg.id;
  const sim = new Game(world, { rules: CONFIG.rules, train: CONFIG.train, avatar: CONFIG.avatar, station: CONFIG.station, tickHz: CONFIG.server.tickHz }, 1, false);
  sim.lobby = !!msg.info.lobby;
  if (pred) { pred.reset(sim, truth); }
  else      { pred = new Predictor(sim, truth); }
  interp.reset();

  // The station building on the two rows north of each station, centred
  // on its middle, front to the track (D11.8).
  //
  stationProps.clear();
  for (const st of world.stations) {
    const [x0, y0] = st[0], len = st.length, h = world.z(world.idx(x0, y0)),
          b = vmesh(models.house);
    b.position.set(x0 + (len / 2), topY(h), y0 - 1);
    b.castShadow = true;
    b.receiveShadow = true;
    stationProps.add(b);
  }
}

// ---- network ----

let ws: WebSocket | null = null;

function say(m: ClientMsg): void {
  if ( ws && (ws.readyState === 1) ) { ws.send(JSON.stringify(m)); }
}

// Rooms and the lobby (D7.6). `roomInfo` is the room this page is in
// (null in the lobby); `wantRoom` the code to join on (re)connecting:
// from ?room= in the address, else the room the page was in. The
// address carries the room's code while in it, so it can be shared and
// a reload joins the same room.
//
//
// `asked`: a join or create is under way. A welcome is taken only then
// or while in a room, so one already on its way when the player left
// (a new level) does not pull the page back in.
//
// ?lobby opens the walk-in lobby on the page too (for trying it out
// without a headset).
//
const walkIn = params.has("lobby");

let roomInfo: RoomInfo | null = null,
    wantRoom = (params.get("room") ?? "").trim().toUpperCase(),
    asked    = false;
const leaveBtn = document.getElementById("leave") as HTMLButtonElement,
      joinRoom = (code: string) => { asked = true; say({ t: "hello", name: lobby.playerName, room: code, character: lobby.character }); },
      lobby    = new Lobby(urlName, joinRoom, o => { asked = true; say({ t: "create", name: lobby.playerName, character: lobby.character, ...o }); });

// Into the walk-in lobby (server/lobby.ts), where AR players go: the
// page's HTML lobby is not shown in the headset.
//
function toWalkIn(): void {
  asked = true;
  say({ t: "lobby", name: lobby.playerName, character: lobby.character });
}
if (wantRoom) { lobby.hide(); }

function roomInUrl(code: string): void {
  const u = new URL(location.href);
  if (code) { u.searchParams.set("room", code); }
  else      { u.searchParams.delete("room"); }
  history.replaceState(null, "", u);
}

// Back to the lobby: the level is dropped and hidden, the list asked
// for; `text` says why, if it was not the player's choice.
//
function toLobby(text = ""): void {
  hush();
  roomInfo = null;
  wantRoom = "";
  asked    = false;
  roomInUrl("");
  if (terrain) { content.remove(terrain.group); }
  world = null; truth = null; shown = null; terrain = null; last = null; pred = null;
  content.visible = false;
  leaveBtn.style.display = "none";
  hud.textContent = "Lobby";
  if (arOn) {
    toWalkIn();
    return;
  }
  lobby.show();
  lobby.error(text);
  say({ t: "list" });
}
leaveBtn.addEventListener("click", () => { say({ t: "leave" }); toLobby(); });
setInterval(() => { if (lobby.shown) { say({ t: "list" }); } }, 2000);

// One settings panel field shows a value.
//
function showSetting(sec: string, key: string, v: unknown): void {
  const el = document.getElementById("set-" + sec + "-" + key) as HTMLInputElement | null;
  if (!el) { return; }
  if (el.type === "checkbox") { el.checked = (v === true); }
  else                        { el.value = String(v); }
}

// After the connection drops, wait for the server with plain HTTP
// requests, then open the WebSocket. Firefox holds back a WebSocket to a
// host that keeps refusing: each failed attempt makes the next wait 1.5
// times longer, up to 60 s, counted from the last failure
// (network.websocket.delay-failed-reconnects, FailDelayManager in
// WebSocketChannel.cpp, checked 2026-11-18). Retrying the WebSocket
// every 2 s through a server restart left the lobby empty for up to a
// minute after the server was back; HTTP requests do not count.
//
const httpUrl = base.href;

function reconnect(): void {
  fetch(httpUrl, { method: "HEAD", mode: "no-cors", cache: "no-store" })
    .then(() => connect(), () => setTimeout(reconnect, 1000));
}

function connect(): void {
  const s = new WebSocket(wsUrl);
  ws = s;
  s.onopen    = () => {
    if      (wantRoom)  { joinRoom(wantRoom); }
    else if (autoMake)  {
      asked = true;
      say({ t: "create", name: lobby.playerName, character: lobby.character, room: autoMake + " test", open: false, difficulty: autoMake,
            levels: Number(params.get("levels") ?? 4), width: 10, length: 50 });
      autoMake = "";
    }
    else if ( arOn || walkIn ) { toWalkIn(); }
    else                { hud.textContent = "Lobby"; lobby.show(); say({ t: "list" }); }
  };
  s.onclose   = () => { hud.textContent = "Disconnected from " + wsUrl + ". Retrying..."; setTimeout(reconnect, 1000); };
  s.onmessage = (e) => {
    const m: ServerMsg = JSON.parse(e.data);
    if (m.t === "rooms") { lobby.rooms(m, joinRoom); return; }
    if (m.t === "said")  { devOut.textContent = m.text; console.log("dev:", m.text); return; }
    if (m.t === "error") {
      asked = false;
      if (roomInfo) { lobby.error(m.text); }
      else          { toLobby(m.text); }
      return;
    }
    if (m.t === "welcome") {
      if ( !roomInfo && !asked ) { return; }
      asked    = false;
      roomInfo = m.info;
      wantRoom = ( m.info.lobby ? "" : m.room );
      roomInUrl(wantRoom);
      lobby.hide();
      content.visible = true;
      leaveBtn.style.display = ( m.info.lobby ? "none" : "block" );
      for (const [sec, vals] of Object.entries(m.config)) {
        Object.assign((CONFIG as unknown as Record<string, object>)[sec], vals);
        for (const [k, v] of Object.entries(vals)) { showSetting(sec, k, v); }
      }
      buildSettings();
      if (m.dev) { buildDev(); }
      setupLevel(m);

      // ?dev=cmd,cmd: shortcuts sent once, after the first level arrives.
      //
      for (const cmd of autoDev) { say({ t: "dev", cmd }); }
      autoDev = [];
      return;
    }
    if (m.t === "config") {
      ((CONFIG as unknown as Record<string, Record<string, unknown>>)[m.section])[m.key] = m.value;
      showSetting(m.section, m.key, m.value);
      return;
    }
    if (m.t === "over") { toLobby(m.text); return; }
    if ( (m.t === "state") && world && truth && shown && terrain ) {
      for (const c of m.cells) { truth.applyCell(c); }
      shownBombs = m.bombs.map(b => ({ ...b }));
      for (const e of m.events) {
        if (!e.startsWith("boom:")) { continue; }
        const [, x, y, z] = e.split(":").map(Number);
        boom(x, y, z, timer.getElapsed());
      }
      soundEvents(m.events, m.train.p);

      // On to the next level of the run (D6.4): the same world, the next
      // pair of stations. The train's place counts along the new level's
      // line, so the in-between drawing starts again.
      //
      if (m.seg !== truth.seg) {
        for (const w of [world, truth, shown]) { w.setSegment(m.seg); }
        line = world.line();
        interp.reset();
        if (roomInfo) { roomInfo = { ...roomInfo, level: (m.seg + 1) }; }
      }
      last = m;
      interp.push(m.time, m.players, m.train.p);

      // The drawn world is the server's plus this player's unconfirmed
      // inputs; without a character of its own yet, just the server's.
      //
      const me = m.players.find(p => (p.id === myId));
      if ( me && pred ) { pred.reconcile(me, m.train); }
      else              { world.copyFrom(truth); }
      syncShown();
    }
  };
}
connect();

// ---- input ----

const controls = new Controls(await loadBindings(), (open, pick) => { showMenu(open, pick); });

// The emote menu's ring: the word picked larger and gold.
//
function showMenu(open: boolean, pick: number): void {
  menuRing.visible = open;
  EMOTES.forEach((e, k) => {
    const t = menuWords[k], a = (k * Math.PI) / 4;
    t.set( open ? [{ parts: [{ text: e, colour: ( (k === pick) ? GOLD : undefined ) }], scale: ( (k === pick) ? 1.3 : 1 ) }] : [] );
    t.group.position.set(Math.sin(a) * MENU_RX, (Math.cos(a) * MENU_RY) - (t.height / 2), 0);
  });
}

// Input steps (D7.4): one every server tick, carrying the buttons held
// and any one-off (boost, emote, tool change) since the last step.
//
let stepAcc = 0, oneBoost = false, oneEmote = -1, oneTool = -1;

// Help: the key list from this person's bindings, toggled by the help
// key (? by default).
//
const helpEl = document.getElementById("help") as HTMLDivElement;
function buildHelp(): void {
  const kb = controls.cfg.keyboard, gp = controls.cfg.gamepad;
  const name = (code: string) => ( ({ Slash: "? (/)", Space: "Space", BracketLeft: "[", BracketRight: "]", Enter: "Enter" } as Record<string, string>)[code] ??
                                   code.replace(/^Key|^Digit/, "").replace(/^Arrow(.*)$/, "$1 arrow") );
  const keys = (k: keyof typeof kb) => kb[k].map(name).join(", ");
  const nums = (b: number | number[]) => ( Array.isArray(b) ? b : [b] ).join(", "),
        pad  = (b: number | number[] | undefined) => ( (b === undefined) ? "" : ("   pad button " + nums(b)) );
  const rows: [string, string][] = [
    [[keys("up"), keys("left"), keys("down"), keys("right")].join(" / "), "walk (relative to the camera)   pad " + gp.move],
    [keys("action") + pad(gp.action), "no tool: pick up, place, drop, use wagons; with a tool: hold to chop or mine"],
    [keys("pickaxe"), "take the pickaxe (mines grey rock)"],
    [keys("axe"), "take the axe (chops trees)"],
    [keys("noTool"), "put the tool away (to pick things up)"],
    [keys("toolPrev") + " " + keys("toolNext") + pad(gp.toolPrev) + " / " + nums(gp.toolNext), "previous / next tool (a button shared with sending an emote sends while the emote menu is open)"],
    [keys("boost") + pad(gp.boost), "boost"],
    [keys("fastForward") + pad(gp.fastForward), "hold: fast-forward the train"],
    [keys("emoteMenu") + pad(gp.emoteMenu), "emote menu (pick with move keys or " + gp.emotePick + ")"],
    [keys("emoteSend") + pad(gp.emoteSend), "send the picked emote"],
    [keys("cameraMode") + pad(gp.cameraMode), "camera: follow the train, follow your character, or free"],
    [keys("cameraSnap") + pad(gp.cameraSnap), "drop the camera's pan (free camera: jump to your character)"],
    ["left / right drag, wheel", "rotate / pan / zoom the camera"],
    [keys("help"), "show or hide this list"],
  ];
  const esc = (t: string) => t.replace(/[&<>]/g, c => ( ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as Record<string, string>)[c] ));
  helpEl.innerHTML = "<h2>Keys</h2><table>" + rows.map(([k, d]) => "<tr><td>" + esc(k) + "</td><td>" + esc(d) + "</td></tr>").join("") + "</table>";
}
buildHelp();

// ---- frame ----

const timer = new THREE.Timer();
timer.connect(document);
const camOffset = new THREE.Vector3(0, CONFIG.view.cameraHeight * 0.5, CONFIG.view.cameraBack);
const myPos = new THREE.Vector3();

// Camera modes (D2.7): follow the train (the middle car), follow this
// player's character, or stay where it is. The cameraMode key steps
// through them; the browser remembers the choice.
//
const CAM_MODES = ["train", "character", "free"], CAM_STORE = "voxel-rail.camera";
let camMode = 0;
try { camMode = Math.max(0, CAM_MODES.indexOf(localStorage.getItem(CAM_STORE) ?? "train")); }
catch { }
const lastFollowed = new THREE.Vector3();

function carryModel(kind: number, n: number): Vox {
  const wagon = wagonOf(kind);
  if (wagon) { return CAR_MODELS[wagon]; }
  return ( (kind === Item.WOOD) ? models.m.wood[n % 2] : ( (kind === Item.ORE) ? models.m.ore[n % 2] : models.m.straight ) );
}

// Finished track shows as a stack on top of the crafting wagons, and
// wood and ore as stacks on the storage wagons: each wagon in turn
// holds up to its share (rules.storageMax of each resource,
// rules.trackMax track), the first filled first.
//
let cargoKey = "";

function drawCargo(t: Train): void {
  const key = t.wood + ":" + t.ore + ":" + t.track + ":" + t.cars.join(",") + ":" + CONFIG.rules.storageMax + ":" + CONFIG.rules.trackMax +
              ":" + t.sticks + ":" + t.dynWood + ":" + t.dynOre;
  if (key === cargoKey) { return; }
  cargoKey = key;
  for (const g of cargo) { g.clear(); }
  const sm = CONFIG.rules.storageMax, tm = CONFIG.rules.trackMax,
        stores = t.cars.flatMap((k, c) => ( (k === "storage") ? [c] : [] )),
        crafts = t.cars.flatMap((k, c) => ( (k === "crafting") ? [c] : [] ));

  // Storage (D6a.25): every cube the wagon holds, at its own size, in
  // layers of 4 along the wagon by 2 across; each 8 more starts a new
  // layer on top, so the load rises with the count.
  //
  stores.forEach((c, n) => {
    const wood = Math.max(0, Math.min(sm, t.wood - (n * sm))), ore = Math.max(0, Math.min(sm, t.ore - (n * sm))),
          load = [...Array(wood).fill(models.m.wood), ...Array(ore).fill(models.m.ore)] as Vox[][],
          sz = CONFIG.view.itemSize, step = Math.max(0.3, sz * 1.25);
    load.forEach((set, k) => {
      const layer = Math.floor(k / 8), j = k % 8, o = vmesh(set[k % set.length]);
      o.position.set((((j % 4) - 1.5) * step), layer * sz, ( (j < 4) ? -0.5 : 0.5 ) * step);
      o.scale.setScalar(itemScale());
      cargo[c].add(o);
    });
  });
  // The dynamite wagon: its sticks side by side, and the wood and ore
  // put in toward the next one in a row behind them.
  //
  const dyn = t.cars.indexOf("dynamite");
  if (dyn >= 0) {
    for (let k = 0; k < t.sticks; k++) {
      const o = stickMesh();
      o.getObjectByName("spark")!.visible = false;
      o.position.set(0, 0.05, (k - ((t.sticks - 1) / 2)) * 0.14);
      cargo[dyn].add(o);
    }
    const bits = [...Array(t.dynWood).fill(models.m.wood), ...Array(t.dynOre).fill(models.m.ore)] as Vox[][];
    bits.forEach((set, k) => {
      const o = vmesh(set[k % set.length]);
      o.scale.setScalar(itemScale() * 0.7);
      o.position.set(-0.45 + ((k % 5) * 0.2), 0.05 + (Math.floor(k / 5) * 0.15), 0.35);
      cargo[dyn].add(o);
    });
  }
  crafts.forEach((c, n) => {
    for (let k = 0; k < Math.min(Math.max(0, Math.min(tm, t.track - (n * tm))), 20); k++) {
      const o = vmesh(models.m.straight);
      o.scale.setScalar(TRACK_PILE * 0.85);
      o.position.y = k * 0.06;
      cargo[c].add(o);
    }
  });
}

// The train rides on the rail tops: the track models are 2 voxels tall
// (TRACK_TOP in src/assets/terrain.ts), sleepers below and rails above.
//
const RAIL_TOP = 2 / 32;

function drawTrain(t: Train): void {
  if (!world) { return; }
  // Each car rests on its two wheel points on the track (D6a.26): placed
  // midway between them, heading from the rear wheel to the front one,
  // tilted by their difference in height; scaled by view.trainScale, with
  // its load kept at its own size.
  //
  const s = CONFIG.view.trainScale;
  makeCars(t.cars);
  t.cars.forEach((_, c) => {
    const cp = carPose(world!, line, t.p - (c * CAR_LEN) - (CAR_LEN / 2), WHEELBASE), o = cars[c],
          run = Math.hypot(cp.front.x - cp.rear.x, cp.front.y - cp.rear.y),
          pitch = Math.atan2(topY(cp.front.z) - topY(cp.rear.z), Math.max(1e-6, run));
    o.position.set(cp.x, topY(cp.z) + RAIL_TOP, cp.y);
    o.rotation.set(0, -cp.heading, pitch, "YZX");
    o.scale.setScalar(s);
    cargo[c].scale.setScalar(1 / s);

    // A derailed train lies tipped over.
    //
    if ( last && (last.phase === "derailed") ) {
      o.rotateX( ((c % 2) === 0) ? 0.9 : -0.6 );
      o.position.y -= 0.1;
    }
  });
  drawCargo(t);
}

// ---- ghost previews ----

// Where a press of the action button would lay track, build a bridge or
// build a ramp, drawn see-through (D6a.18). Uses the same planner as the
// server, run on this page's copy of the world.
//
const ghostMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false }),
      ghost    = new THREE.Group();
content.add(ghost);
let planner: Game | null = null, ghostKey = "";

function drawGhost(w: World, st: State): void {

  // Where this player's character is predicted to be (D7.4): the press
  // goes to the server after the same moves, so it acts there.
  //
  const seen = st.players.find(p => (p.id === myId)), at = pred?.me,
        me   = ( ( seen && at ) ? { ...own(seen), x: at.x, y: at.y, facing: at.facing } : seen );
  if ( !planner || (planner.w !== w) ) {
    planner = new Game(w, { rules: CONFIG.rules, train: CONFIG.train, avatar: CONFIG.avatar, station: CONFIG.station, tickHz: CONFIG.server.tickHz }, 1, false);
  }
  planner.line = line;
  const pl: Plan | null = ( (me && !me.dead && (me.tool === Tool.NONE)) ? planner.plan(me.x, me.y, me.facing, me.carry, me.count) : null );
  const key = ( pl ? (pl.kind + ":" + pl.cell + ":" + pl.conn + ":" + pl.dir) : "" );
  if (key === ghostKey) { return; }
  ghostKey = key;
  ghost.clear();
  if (!pl) { return; }
  const [x, y] = w.xy(pl.cell), cx = x + 0.5, cz = y + 0.5;
  const add = (m: Vox, yaw: number, at: number) => {
    const o = new THREE.Mesh(vmesh(m).geometry, ghostMat);
    o.position.set(cx, at, cz);
    o.rotation.y = yaw;
    ghost.add(o);
  };
  // On a ramp the ghost is the sloped piece, turned with the ramp.
  //
  if ( (pl.kind === "track") && isRamp(w.type(pl.cell)) ) { add(models.m.slope, yawFor(w.g.dir[pl.cell]), topY(pl.z)); }
  else if (pl.kind === "track") {
    const c = pl.conn, ns = ( (c === 0b0101) || (c === 0b0001) || (c === 0b0100) ),
          ew = ( (c === 0b1010) || (c === 0b0010) || (c === 0b1000) );
    if      (ns) { add(models.m.straight, Math.PI / 2, topY(pl.z)); }
    else if (ew) { add(models.m.straight, 0, topY(pl.z)); }
    else if (c)  { add(models.m.curve, curveYaw(c), topY(pl.z)); }
    else         { add(models.m.straight, ( ((me!.facing % 2) === 0) ? (Math.PI / 2) : 0 ), topY(pl.z)); }
  }
  else if (pl.kind === "pile") {
    for (let k = 0; k < Math.min(me!.count, 20); k++) {
      add(models.m.straight, ( ((k % 2) === 0) ? 0 : 0.12 ), topY(pl.z) + (k * 0.07));
      ghost.children[ghost.children.length - 1].scale.setScalar(TRACK_PILE);
    }
  }
  else if (pl.kind === "bridge") { add(models.m.bridge[0], 0, topY(pl.z) - 0.5); }
  else if (pl.kind === "ramp")   { add(models.m.ramp[0], yawFor(pl.dir), topY(pl.z)); }
}

// ---- edge markers ----

// An arrow on the window's edge pointing east (turned to point west),
// with a faint disc on the edge behind it; yellow for this player's own
// character, white for the others.
//
const EDGE_GEO = new THREE.ConeGeometry(0.16, 0.36, 12).rotateZ(-Math.PI / 2),
      EDGE_DISC = new THREE.CircleGeometry(0.3, 24).rotateY(Math.PI / 2),
      EDGE_MINE = new THREE.MeshBasicMaterial({ color: 0xf0c040 }),
      EDGE_THEM = new THREE.MeshBasicMaterial({ color: 0xffffff }),
      EDGE_BACK = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });

function edgeMarker(mine: boolean): THREE.Group {
  const g = new THREE.Group(), arrow = new THREE.Mesh(EDGE_GEO, ( mine ? EDGE_MINE : EDGE_THEM )),
        disc = new THREE.Mesh(EDGE_DISC, EDGE_BACK);
  arrow.position.x = 0.1;
  disc.position.x = 0.3;
  g.add(arrow, disc);
  g.visible = false;
  return g;
}

// ---- collision view (view.showColliders) ----

// Outlines drawn on top of everything: character cylinders (cyan), the
// train's circles (orange), the start pad (green), and the cells that
// block this player's character from where it stands (red).
//
const debug = new THREE.Group();
content.add(debug);
const ringGeo = new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 33 }, (_, k) => new THREE.Vector3(Math.cos((k / 32) * Math.PI * 2), 0, Math.sin((k / 32) * Math.PI * 2)))),
      squareGeo = new THREE.BufferGeometry().setFromPoints(
        [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].map(([x, z]) => new THREE.Vector3(x, 0, z))),
      lineMat = (c: number) => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true }),
      CYAN = lineMat(0x40e0ff), ORANGE = lineMat(0xff9030), GREEN = lineMat(0x60ff60), RED = lineMat(0xff3030);

function ring(x: number, y: number, z: number, r: number, m: THREE.Material): void {
  const o = new THREE.Line(ringGeo, m);
  o.position.set(x, y, z);
  o.scale.set(r, 1, r);
  o.renderOrder = 10;
  debug.add(o);
}

function drawColliders(w: World, st: State, trainP: number): void {
  debug.clear();
  debug.visible = CONFIG.view.showColliders;
  if (!debug.visible) { return; }
  const r = CONFIG.avatar.radius;
  for (const p of st.players) {
    if (p.dead) { continue; }
    const a = avatars.get(p.id), x = ( a ? a.x : p.x ), z = ( a ? a.y : p.y ), y = standY(w, x, z);
    for (const h of [0.02, 0.45, 0.9]) { ring(x, y + h, z, r, CYAN); }
  }
  for (const q of trainBody(w, line, trainP, CONFIG.train.collideRadius, st.train.cars.length)) {
    ring(q.x, topY(q.z) + 0.03, q.y, CONFIG.train.collideRadius, ORANGE);
  }
  if (st.phase === "ready") { ring(st.pad.x, standY(w, st.pad.x, st.pad.y) + 0.03, st.pad.y, PAD_RADIUS, GREEN); }

  const me = pred?.me;
  if ( !me || (me.dead > 0) ) { return; }
  const cx = Math.floor(me.x), cy = Math.floor(me.y), from = w.idx(cx, cy), y = standY(w, me.x, me.y) + 0.04;
  for (let yy = cy - 1; yy <= (cy + 1); yy++) {
    for (let xx = cx - 1; xx <= (cx + 1); xx++) {
      const j = ( w.inside(xx, yy) ? w.idx(xx, yy) : -1 );
      if (!w.blocks(from, j, (me.boostT > 0))) { continue; }
      const o = new THREE.Line(squareGeo, RED);
      o.position.set(xx, y, yy);
      o.renderOrder = 10;
      debug.add(o);
    }
  }
}

// ---- settings panel (a development tool, not part of the game's look) ----

// One input per number or switch in config/game.json, with its
// description as a tooltip. Shared sections go to the server, which
// tells every client; "view" changes only this page.
//
// Development shortcuts (server --dev, server/dev.ts): buttons in the
// settings panel, and in the page's address ?create=DIFFICULTY (make a
// room of that difficulty, 4 levels or ?levels=N, and join it) and
// ?dev=cmd,cmd (sent once the level arrives), so a screenshot tool (or a
// person) gets to a situation without playing up to it.
//
let autoMake = ( params.get("room") ? "" : (params.get("create") ?? "") ),
    autoDev  = (params.get("dev") ?? "").split(",").filter(c => c);
const devOut = document.createElement("div");

function buildDev(): void {
  if (document.getElementById("devBox")) { return; }

  // For tools/shot.ts --js: the camera, its controls and the characters,
  // to look closely.
  //
  (globalThis as unknown as Record<string, unknown>).voxelRail = { camera, orbit, avatars, me: () => myId, birds };
  const box = document.createElement("fieldset"), leg = document.createElement("legend");
  box.id = "devBox";
  leg.textContent = "dev (server --dev)";
  box.appendChild(leg);
  const button = (label: string, cmd: () => string) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => say({ t: "dev", cmd: cmd() }));
    b.style.margin = "2px";
    return b;
  };
  const choose = (opts: string[]) => {
    const sel = document.createElement("select");
    for (const o of opts) { const e = document.createElement("option"); e.value = o; e.textContent = o; sel.appendChild(e); }
    return sel;
  };
  const offer = choose(UPGRADES.map(u => u.kind)), give = choose(["wood", "ore", "track", "stick", "lit", "storage", "crafting", "dynamite"]),
        wagon = choose(["storage", "crafting", "dynamite"]), level = document.createElement("input");
  level.type = "number"; level.value = "2"; level.style.width = "3em";
  level.addEventListener("keydown", e => e.stopPropagation());
  const row = (...els: HTMLElement[]) => { const d = document.createElement("div"); d.append(...els); box.appendChild(d); };
  row(button("Arrive", () => "arrive"), button("Fill wagons", () => "fill"), button("Crash", () => "crash"));
  row(offer, button("Offer", () => "offer:" + offer.value));
  row(give, button("Give", () => "give:" + give.value));
  row(wagon, button("Add wagon", () => "wagon:" + wagon.value));
  row(level, button("Skip to level", () => "skip:" + level.value));
  devOut.style.color = "#9fd";
  box.appendChild(devOut);
  setBody.prepend(box);
}

function buildSettings(): void {
  if (setBody.childElementCount) { return; }
  const sections = [...SHARED_SECTIONS, "view"];
  for (const sec of sections) {
    const vals = (CONFIG as unknown as Record<string, Record<string, unknown>>)[sec],
          box  = document.createElement("fieldset"),
          leg  = document.createElement("legend");
    leg.textContent = sec + ( (sec === "levelgen") ? " (next level)" : ( (sec === "view") ? " (this page)" : "" ) );
    box.appendChild(leg);
    for (const [key, v] of Object.entries(vals)) {
      if ( (typeof v !== "number") && (typeof v !== "boolean") ) { continue; }
      const row = document.createElement("label"), inp = document.createElement("input");
      row.title = DOCS[sec]?.[key] ?? "";
      inp.id = "set-" + sec + "-" + key;
      if (typeof v === "boolean") { inp.type = "checkbox"; inp.checked = v; }
      else                        { inp.type = "number"; inp.step = "any"; inp.value = String(v); }
      inp.addEventListener("change", () => {
        const value = ( (inp.type === "checkbox") ? inp.checked : Number(inp.value) );
        if ( (typeof value === "number") && !Number.isFinite(value) ) { return; }
        if (sec === "view") {
          vals[key] = value;
          if (key === "itemSize") { terrain?.rebuildProps(); cargoKey = ""; for (const a of avatars.values()) { a.handKey = ""; } }
          if (TERRAIN_VIEW_KEYS.has(key)) { terrain?.rebuildAll(); }
          return;
        }
        say({ t: "set", section: sec, key, value });
      });
      inp.addEventListener("keydown", e => e.stopPropagation());
      row.append(key + " ", inp);
      box.appendChild(row);
    }
    setBody.appendChild(box);
  }
  const restart = document.createElement("button");
  restart.textContent = "New run now";
  restart.addEventListener("click", () => say({ t: "restart" }));
  setBody.appendChild(restart);
}

// Called by the renderer's animation loop, which in AR runs at the
// headset's rate and passes the XR frame.
//
// The level-end message (2026-11-19, in blocks, a few words a line):
// what happened, the upgrade choice while it is open, and what comes
// next with its seconds: the next level or the lobby.
//
const END_HEAD: Record<string, string> = { derailed: "DERAILED", timeout: "OUT OF TIME", arrived: "ARRIVED" };

function endLines(st: State): TextLine[] {
  if (!END_HEAD[st.phase]) { return []; }
  const lastLevel = ( !!roomInfo && (roomInfo.level >= roomInfo.levels) ),
        more      = ( (st.phase === "arrived") && !lastLevel ),
        then      = ( more ? "NEXT LEVEL " : "LOBBY " );
  return [ ( ( (st.phase === "arrived") && lastLevel ) ? "RUN COMPLETE" : END_HEAD[st.phase] ),
           ( ( more && st.offers.length && !st.picked ) ? { parts: [{ text: "PICK UPGRADE", colour: GOLD }], scale: 0.7 } : "" ),
           { parts: [{ text: then }, { text: String(Math.ceil(Math.max(0, st.next))), colour: GOLD }], scale: 0.8 } ];
}

// ---- sound (D11b) ----

// Where the train's front is, in board units, with the train at line
// position `p`.
//
function trainFront(w: World, p: number): Pt3 {
  const k = Math.max(0, Math.min(line.length - 1, Math.floor(p)));
  if (!line.length) { return { x: 0, y: 0, z: 0 }; }
  const [x, y] = w.xy(line[k]);
  return { x: x + 0.5, y: standY(w, x + 0.5, y + 0.5) + 0.5, z: y + 0.5 };
}

function avatarAt(id: number): Pt3 | null {
  const a = avatars.get(id);
  return ( a ? { x: a.x, y: a.h + 0.5, z: a.y } : null );
}


// What the server says happened: the train leaving sounds its horn, a
// crash and a stick going off explode, a character against the train
// sounds the horn, a bridge or a stair built rubs.
//
function soundEvents(events: string[], trainP: number): void {
  const w = shown;
  if (!w) { return; }
  for (const e of events) {
    const [kind, a, b, c] = e.split(":");
    if      (kind === "start")    { hornAt = timer.getElapsed(); sounds.play("trainStart", trainFront(w, trainP)); const f = trainFront(w, trainP); birds.disturb(f.x, f.y, f.z); }
    else if (kind === "derailed") { sounds.play("crash", trainFront(w, trainP)); }
    else if (kind === "boom")     { sounds.play("blast", { x: Number(a), y: Number(c), z: Number(b) }); }
    else if (kind === "bump")     { const at = avatarAt(Number(a)); if (at) { sounds.play("bump", at); } }
    else if (kind === "built")    { const [x, y] = w.xy(Number(a)); sounds.play("built", { x: x + 0.5, y: standY(w, x + 0.5, y + 0.5), z: y + 0.5 }); }
  }
}

// Every frame: the chug while the train runs (faster on fast-forward),
// the horn more and more often as the train nears the end of track that
// does not reach the end station, and chopping sounds, one random clip
// after another, for each character chopping. Mining sounds come with
// each swing's strike (mineStrike). Either fades out when they stop.
//
function drawSound(w: World, st: State, trainP: number, now: number): void {
  const running = ( (st.phase === "running") && !roomInfo?.lobby ), front = trainFront(w, trainP);
  if ( running && (!chug || chug.ended) ) { chug = sounds.play("trainRunning", front, { loop: true }); }
  if (chug) {
    if (running) {
      chug.move(front);
      chug.src.playbackRate.setTargetAtTime(( st.train.fast ? 1.5 : 1 ), 0, 0.3);
    }
    else {
      chug.stop(0.8);
      chug = null;
    }
  }
  const [ex, ey] = w.end[w.end.length - 1], warn = CONFIG.view.hornWarnCells, ahead = (line.length - 0.5) - trainP;
  if ( running && !line.includes(w.idx(ex, ey)) && (ahead < warn) ) {
    const every = 0.35 + (1.65 * (Math.max(0, ahead) / Math.max(1e-3, warn)));
    if ((now - hornAt) >= every) { hornAt = now; sounds.play("endWarning", front); }
  }
  for (const sp of st.players) {
    const p = own(sp), set = ( ( p.hitting && !p.dead ) ? ( (p.tool === Tool.PICK) ? "mine" : ( (p.tool === Tool.AXE) ? "chop" : null ) ) : null ),
          v = chops.get(p.id), at = avatarAt(p.id);
    if ( set && at ) {
      if ( (set === "chop") && ( !v || v.ended ) ) {
        const nv = sounds.play(set, at);
        if (nv) { chops.set(p.id, nv); }
      }
      else if (v) { v.move(at); }
    }
    else if (v) {
      v.stop(0.3);
      chops.delete(p.id);
    }
  }
}

// ---- weather and birds (D11.20, D11.21) ----

// The run's climate, made again when the world or the weather settings
// change (runSeed, climateKey, weatherWorld above).
//

function weatherFor(w: World): void {
  const V = CONFIG.view, key = runSeed + ":" + w.w + ":" + V.rainChance + ":" + V.snowChance + ":" + V.weatherBlendCells + ":" + V.puddles;
  if ( (key === climateKey) && (weatherWorld === w) ) { return; }
  climateKey   = key;
  weatherWorld = w;
  const mids = w.stations.slice(1, -1).map(c => ( (c[0][0] + c[c.length - 1][0] + 1) / 2 ));
  weather.setWorld(w, new Climate(runSeed, mids, V.rainChance, V.snowChance, V.weatherBlendCells), (x, z) => standY(w, x, z));
}

// Where a bird can stand on cell (x, z): on a tree's crown, on grey
// rock, on the ground; not on water.
//
function perchAt(w: World, x: number, z: number): number | null {
  if (!w.inside(x, z)) { return null; }
  const i = w.idx(x, z), c = w.type(i);
  if (c === Cell.WATER) { return ( w.bridge[i] ? standY(w, x + 0.5, z + 0.5) : null ); }
  if ( (c === Cell.TREE) || (c === Cell.ROCK) ) { return ( topY(w.z(i)) + 0.5 ); }
  return standY(w, x + 0.5, z + 0.5);
}

// A character or a train car within r cells of (x, z).
//
function nearThings(x: number, z: number, r: number): boolean {
  for (const a of avatars.values()) { if (Math.hypot(a.x - x, a.y - z) < r) { return true; } }
  for (const c of cars) { if (Math.hypot(c.position.x - x, c.position.z - z) < (r + 0.8)) { return true; } }
  return false;
}

function frame(_time: number, xf?: XRFrame): void {
  perf.start = performance.now();
  timer.update();
  const real = timer.getDelta(), dt = Math.min(0.1, real);
  ar.update(xf);
  controls.xrPads = ar.pads;
  const f = controls.read();
  readAim();
  if (f.help) { helpEl.style.display = ( (helpEl.style.display === "block") ? "none" : "block" ); }
  // Step the input at the server's tick rate: each step is numbered,
  // sent, and applied to this player's own character at once (D7.4).
  //
  // Up on the stick or keys walks away from the camera; right walks to
  // the camera's right. The level's x and y are three.js X and Z. In AR,
  // the way the viewer looks across the board. Each part is held to -1
  // to 1 as the server holds it, so both move the same way.
  //
  if (f.boost)      { oneBoost = true; }
  if (f.emote >= 0) { oneEmote = f.emote; }
  if (f.tool >= 0)  { oneTool  = f.tool; }
  const stepS = 1 / CONFIG.server.tickHz;
  stepAcc = Math.min(stepAcc + dt, stepS * 4);
  if (stepAcc >= stepS) {
    const look = ar.lookOnBoard(),
          fwd  = ( arOn ? new THREE.Vector3(look.x, 0, look.z) : new THREE.Vector3().subVectors(orbit.target, camera.position) );
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) { fwd.set(0, 0, -1); }
    fwd.normalize();
    const clamp1 = (v: number) => Math.max(-1, Math.min(1, v)),
          mx     = clamp1((-fwd.z * f.mx) + (fwd.x * -f.my)),
          my     = clamp1((fwd.x * f.mx) + (fwd.z * -f.my));
    for (; stepAcc >= stepS; stepAcc -= stepS) {
      if ( !ws || (ws.readyState !== 1) || !pred ) { continue; }
      const inp: Input = { mx, my, action: f.action, boost: oneBoost, emote: oneEmote, tool: oneTool, fast: f.fast, aim: aimNow };
      oneBoost = false; oneEmote = -1; oneTool = -1;
      say({ t: "input", seq: pred.step(inp), ...inp });
    }
    syncShown();
  }
  if ( !world || !terrain || !last ) { renderer.info.reset(); draw(); framed(real); return; }
  terrain.update();
  terrain.setTime(timer.getElapsed());
  chips.update(dt);
  puffs.update(dt);
  blast.update(dt);
  if ( (last.phase === "derailed") && (lastPhase !== "derailed") && (lastPhase !== "") ) { derail(world, last.train, timer.getElapsed()); }
  lastPhase = last.phase;
  interp.advance(dt);
  const trainP = interp.train() ?? last.train.p,
        mine   = ( pred?.me ? pred.draw(stepAcc / stepS, dt) : null );
  const tr = ( pred?.me ? pred.sim.train : last.train );
  drawTrain({ ...tr, p: trainP });
  drawPad(last.pad, ( roomInfo?.lobby ? "lobby" : last.phase ), world, timer.getElapsed());
  drawLobby(( last.lobby ?? [] ), world, timer.getElapsed());
  drawOffers(last.offers, world, timer.getElapsed());
  drawGroundWagons(world);
  drawBombs(world, dt, timer.getElapsed());
  drawSound(world, last, trainP, timer.getElapsed());
  drawAim(world);
  drawColliders(world, last, trainP);
  drawGhost(world, last);

  // Characters: this player's where it predicts (pred), the others a
  // little in the past between server states (interp).
  //
  const seen = new Set<number>();
  for (const sp of last.players) {
    const p = own(sp);
    seen.add(p.id);
    let a = avatars.get(p.id);

    // A character changed (the walk-in lobby's character circles) is
    // made again, where the old one stood.
    //
    if ( a && (a.character !== p.character) ) {
      const old = a;
      dropAvatar(p.id);
      a = makeAvatar(p);
      a.x = old.x; a.y = old.y; a.h = old.h; a.yaw = old.yaw;
      avatars.set(p.id, a);
    }
    if (!a) { a = makeAvatar(p); avatars.set(p.id, a); }
    const k  = Math.min(1, dt * 15), ox = a.x, oy = a.y,
          me = ( (p.id === myId) && mine && pred?.me ),
          at = ( me ? mine! : ( interp.player(p.id) ?? p ) );
    a.x = at.x; a.y = at.y;
    a.moving = (a.moving * 0.8) + ((Math.hypot(a.x - ox, a.y - oy) / Math.max(dt, 1e-3)) * 0.2);
    const ty = standY(world, a.x, a.y);
    a.h += (ty - a.h) * k;
    a.root.position.set(a.x, a.h, a.y);
    // Turn toward the heading (any angle: 8 ways on keys, any way on a
    // stick), the short way round, quickly but not in one frame.
    //
    const hd   = ( me ? pred!.me!.heading : p.heading ),
          want = Math.atan2(Math.cos(hd), Math.sin(hd));
    let dy = want - a.yaw;
    dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
    a.yaw += dy * Math.min(1, dt * 18);
    a.root.rotation.y = a.yaw;
    a.root.visible = true;

    // What the upgrades taken look like on every character (D6.7).
    //
    const gk = ( (taken().carry ?? 0) + ":" + (taken().speed ?? 0) + ":" + (taken().tools ?? 0) );
    if (gk !== a.gearKey) {
      for (const o of a.gear) { o.removeFromParent(); }
      a.gear    = characterGear(a.root, taken());
      a.gearKey = gk;
      for (const t of a.tools) { toolGear(t, taken().tools ?? 0); }
    }
    a.tools[0].visible = (p.tool === Tool.PICK);
    a.tools[1].visible = (p.tool === Tool.AXE);
    for (const t of a.tools) { t.scale.setScalar(CONFIG.view.toolScale); }

    // A boost starting kicks a puff from the feet, behind the heading.
    //
    if ( p.boosting && !a.boosted && !p.dead ) { puffs.burst(a.x, a.h, a.y, Math.cos(p.heading), Math.sin(p.heading)); }
    a.boosted = p.boosting;

    const anim = ( p.dead ? "die" : ( p.hitting ? "attack-melee-right" : ( (a.moving > 0.5) ? ( p.boosting ? "sprint" : "walk" ) :
                 ( p.count ? "holding-both" : "idle" ) ) ) );
    play(a, anim);

    // The swing runs view.swingsPerSecond times a second (2026-11-20);
    // with the pickaxe, each strike plays one mine sound, picked at
    // random (mining: chopping sounds run on regardless).
    //
    const swing = a.actions.get(SWING);
    if (swing) { swing.timeScale = Math.max(0.1, CONFIG.view.swingsPerSecond) * swing.getClip().duration; }
    a.mixer.update(dt);
    if ( swing && (a.current === SWING) && (p.tool === Tool.PICK) && !p.dead ) {
      const d = swing.getClip().duration, t = swing.time % d;
      if (passed(Math.max(0, a.swingT), t, SWING_STRIKE * d)) { mineStrike(p.id); }
      a.swingT = t;
    }
    else { a.swingT = -1; }

    // Carried stack in the hands (D11a.3).
    //
    const key = p.carry + ":" + p.count + ":" + ( (p.fuse >= 0) ? "lit" : "" );
    if (key !== a.handKey) {
      a.handKey = key;
      a.hands.clear();
      if (p.carry === Item.DYNAMITE) {
        const st = stickMesh();
        st.getObjectByName("spark")!.visible = (p.fuse >= 0);
        st.position.y = 0.1;
        a.hands.add(st);
      }
      else if (wagonOf(p.carry)) {
        const o = carMesh(wagonOf(p.carry)!);
        o.scale.setScalar(0.45);
        o.position.y = 0.05;
        a.hands.add(o);
      }
      // Wood and ore: a column of cubes view.itemSize on a side; track:
      // pieces at pile size.
      //
      for (let n = 0; ( (n < p.count) && !wagonOf(p.carry) && (p.carry !== Item.DYNAMITE) ); n++) {
        const o = vmesh(carryModel(p.carry, n));
        if      (p.carry === Item.TRACK) { o.scale.setScalar(TRACK_PILE); o.position.y = n * 0.07; }
        else                             { o.scale.setScalar(itemScale()); o.position.y = n * CONFIG.view.itemSize; }
        o.castShadow = true;
        a.hands.add(o);
      }
    }

    // Over the head, in blocks (2026-11-19), from the top down: a red X
    // while an action is refused (taking out a tool with nowhere to put
    // what is carried, D6a.20), the emote sent, a lit stick's whole
    // seconds left, and the player's name. Lines are stacked from the
    // bottom, so the name stays put and the rest stand on it.
    //
    const lit = ( (p.carry === Item.DYNAMITE) && (p.fuse >= 0) );
    a.over.set([ ( p.denied ? { parts: [{ text: "X", colour: RED_TEXT }], scale: 1.6 } : "" ),
                 ( (p.emote >= 0) ? { parts: [{ text: EMOTES[p.emote], colour: GOLD }] } : "" ),
                 ( lit ? { parts: [{ text: String(Math.ceil(p.fuse)), colour: RED_TEXT }], scale: 1.6 } : "" ),
                 { parts: [{ text: shownName(p.name) }], scale: NAME_SCALE } ]);
    a.over.group.position.set(a.x, a.h + ( ( (p.id === myId) && controls.menu ) ? 2.05 : 1.15 ), a.y);

    if (p.id === myId) { myPos.set(a.x, a.h, a.y); }
  }
  for (const [id, a] of avatars) {
    if (seen.has(id)) { continue; }
    dropAvatar(id);
  }

  // Camera (D2.3, D2.7): left drag orbits, wheel zooms, right drag
  // pans. A pan is kept as an offset from what the camera follows until
  // the cameraSnap key drops it (in free mode, snap jumps to the
  // character); changing mode drops it too. Rotation and zoom stay.
  //
  if (f.camMode) {
    camMode = (camMode + 1) % CAM_MODES.length;
    try { localStorage.setItem(CAM_STORE, CAM_MODES[camMode]); }
    catch { }
  }
  const followed = ( ( (camMode === 0) && cars[1] ) ? cars[1].position.clone() :
                   ( ( (camMode === 1) || f.snap ) ? myPos.clone() : lastFollowed.clone() ) );
  const half   = ( arOn ? CONFIG.view.arWindowCells : CONFIG.view.windowCells ) / 2,
        centre = new THREE.Vector3();
  if (arOn) {
    // AR: the board stays on the table and the level slides along under
    // it, keeping what the camera mode follows in the middle, without
    // running past either end of the level.
    //
    // A one-hand drag moves the level with the hand at once; the camera
    // keys (snap, mode) drop the drag.
    //
    const lo = Math.min(half, world.w / 2), hi = Math.max(world.w - half, world.w / 2),
          fit = (x: number) => Math.max(lo, Math.min(hi, x)),
          d   = ar.takePan();
    if (f.snap || f.camMode) { arPan = 0; }
    arCentre = fit(arCentre - d);
    arPan    = fit(followed.x + arPan - d) - followed.x;
    arCentre += (fit(followed.x + arPan) - arCentre) * Math.min(1, dt * 3);
    centre.set(arCentre, 0, world.h / 2);
    content.position.set(-centre.x, 0, -centre.z);
  }
  else {
    const pan  = ( (f.snap || f.camMode) ? new THREE.Vector3() : orbit.target.clone().sub(lastFollowed) );
    const goal  = followed.clone().add(pan),
          delta = goal.sub(orbit.target);
    orbit.target.add(delta);
    camera.position.add(delta);
    if (camera.position.distanceTo(orbit.target) < 0.01) { camera.position.copy(orbit.target).add(camOffset); }
    orbit.update();
    centre.copy(orbit.target);
  }
  lastFollowed.copy(followed);
  sun.target.position.copy(centre);
  sun.position.copy(centre).addScaledVector(SUN_DIR, 30);

  // The sun's shadow box is set in room units, so it grows and shrinks
  // with the board.
  //
  const bs = board.scale.x;
  if (bs !== shadowScale) {
    shadowScale = bs;
    const sc = sun.shadow.camera;
    sc.left = -18 * bs; sc.right  = 18 * bs;
    sc.top  = 18 * bs;  sc.bottom = -18 * bs;
    sc.near = bs;       sc.far    = 60 * bs;
    sc.updateProjectionMatrix();
    sun.shadow.normalBias = 0.02 * bs;
  }

  // The window's clipping planes, set in level units and moved into the
  // room with the board.
  //
  board.updateMatrixWorld(true);
  clipW.set(AXIS_E, -(centre.x - half)).applyMatrix4(content.matrixWorld);
  clipE.set(AXIS_W, centre.x + half).applyMatrix4(content.matrixWorld);
  terrain.setWindow(centre.x - half, centre.x + half);

  // Weather and birds over the window (D11.20, D11.21).
  //
  weatherFor(world);
  weather.update(dt, centre.x - half, centre.x + half, arOn);
  birds.update(dt, { x0: centre.x - half, x1: centre.x + half, depth: world.h, perch: (x, z) => perchAt(world!, x, z),
                     near: (x, z, r) => nearThings(x, z, r) });

  // A character outside the window shows as a marker on the window's
  // edge, at its row and height, pointing out toward it (D2.5).
  //
  for (const p of last.players) {
    const a = avatars.get(p.id);
    if (!a) { continue; }
    const out = ( (a.x < (centre.x - half)) ? -1 : ( (a.x > (centre.x + half)) ? 1 : 0 ) );
    a.edge.visible = ( (out !== 0) && !p.dead );
    if (!a.edge.visible) { continue; }
    a.edge.position.set(centre.x + (out * (half - 0.35)), a.h + 0.3, a.y);
    a.edge.rotation.set(0, ( (out > 0) ? 0 : Math.PI ), 0);
    a.edge.scale.setScalar(1 + (0.12 * Math.sin(timer.getElapsed() * 5)));
  }

  menuRing.position.set(myPos.x, myPos.y + 1.05, myPos.z);

  // The level-end message, or in AR, while the board is being placed,
  // how to put it down.
  //
  msgText.set( ( arOn && !ar.placed ) ? ["LOOK AT TABLE"] : endLines(last) );
  msgText.group.position.set(centre.x, 1.6, centre.z);

  // The seconds until the train leaves, over the start pad, above what
  // is shown over the heads of whoever stands in it.
  //
  const leaves = ( (last.phase === "waiting") ? Math.ceil(Math.max(0, CONFIG.train.startDelay - (last.time - last.startT))) : 0 );
  leaveText.set( (leaves > 0) ? [String(leaves)] : [] );
  leaveText.group.position.set(last.pad.x, standY(world, last.pad.x, last.pad.y) + 2.7, last.pad.y);

  // The derailment shake moves the camera on the page and the level on
  // the AR board (the viewer's own head is not ours to move), only for
  // this frame's drawing.
  //
  shake( ( (derailT >= 0) ? (timer.getElapsed() - derailT) : -1 ), shakeOff);
  shakeOff.add(shake( ( (boomT >= 0) ? (timer.getElapsed() - boomT) : -1 ), boomShake).multiplyScalar(0.7));
  if (arOn) { content.position.add(shakeOff); }
  else      { camera.position.add(shakeOff); }

  // Development read-out (not part of the game's look).
  //
  const seenMe = last.players.find(p => (p.id === myId)), me = ( seenMe ? own(seenMe) : undefined ),
        t      = ( pred?.me ? pred.sim.train : last.train );
  const left = ( (last.startT >= 0) ? Math.max(0, last.limit - (last.time - last.startT)) : last.limit );
  hud.textContent =
    ( roomInfo ? (roomInfo.name + " (" + roomInfo.code + ")   level " + roomInfo.level + " of " + roomInfo.levels + "   " +
                  roomInfo.width + " x " + roomInfo.length + ", " + roomInfo.difficulty + "\n") : "" ) +
    last.phase.toUpperCase() + ( (last.next >= 0) ? ("   next level in " + last.next.toFixed(0) + " s") : "" ) +
    "   train " + t.v.toFixed(2) + " cells/s" + ( t.fast ? " (fast-forward)" : "" ) + "   " +
    ( (last.phase === "ready") ? "stand in the start circle to begin   " : "" ) +
    ( (last.phase === "waiting") ? ("leaves in " + Math.max(0, CONFIG.train.startDelay - (last.time - last.startT)).toFixed(0) + " s   ") : "" ) +
    "timer " + ( Number.isFinite(left) ? left.toFixed(0) : "-" ) + " s\n" +
    "storage wagons: " + t.wood + " wood, " + t.ore + " ore (" + (CONFIG.rules.storageMax * t.cars.filter(k => (k === "storage")).length) +
    " each)   track on crafting wagons: " + t.track + "/" + (CONFIG.rules.trackMax * t.cars.filter(k => (k === "crafting")).length) +
    ( t.crafts.length ? (" (making " + t.crafts.length + ")") : "" ) +
    ( t.cars.includes("dynamite") ? ("   dynamite wagon: " + t.sticks + "/" + CONFIG.rules.dynamiteMax + " sticks, next needs " +
                                     t.dynWood + "/" + CONFIG.rules.dynamiteWood + " wood, " + t.dynOre + "/" + CONFIG.rules.dynamiteOre + " ore" +
                                     ( (t.dynT >= 0) ? " (making)" : "" )) : "" ) + "\n" +
    "carrying: " + ( me && me.count ? (me.count + " " + ITEM_NAMES[me.carry]) : "nothing" ) +
    ( ( me && (me.carry === Item.DYNAMITE) ) ?
      ( (me.fuse < 0) ? " (press to light; beside the dynamite wagon, to put it back)" :
                        (" (fuse " + me.fuse.toFixed(1) + " s: tap to put it down, hold to throw" +
                         ( (aimNow >= 0) ? ", tilt the controller up to throw farther)" : ", the longer the farther)" )) ) : "" ) +
    "   holding: " + ( me ? TOOL_NAMES[me.tool] : "-" ) + "   camera: " + CAM_MODES[camMode] + "   (? for keys)\n" + perfLine();

  // Every text in blocks turns to the viewer.
  //
  const viewCam = ( arOn ? renderer.xr.getCamera() : camera ),
        eyeW    = viewCam.getWorldPosition(new THREE.Vector3()),
        eye     = content.worldToLocal(eyeW.clone());

  // The ear is this player's character (else the middle of the view);
  // left and right as the view looks.
  //
  const rightL = content.worldToLocal(new THREE.Vector3(1, 0, 0).applyQuaternion(viewCam.getWorldQuaternion(new THREE.Quaternion())).add(eyeW)).sub(eye);
  sounds.listen(( avatarAt(myId) ?? { x: centre.x, y: 0, z: centre.z } ), { x: rightL.x, z: rightL.z });
  sounds.update();
  for (const t of [msgText, leaveText, ...bombTexts, ...[...avatars.values()].map(a => a.over)]) { t.face(eye); }

  // The lobby's words turn with their circle's group, which stands still.
  //
  for (const v of lobbyViews.values()) {
    const g = v.group.position;
    v.text.group.rotation.y = Math.atan2(eye.x - g.x, eye.z - g.z);
  }
  menuRing.rotation.y = Math.atan2(eye.x - menuRing.position.x, eye.z - menuRing.position.z);
  menuRing.position.x += Math.sin(menuRing.rotation.y) * 0.7;
  menuRing.position.z += Math.cos(menuRing.rotation.y) * 0.7;

  renderer.info.reset();
  draw();
  framed(real);
  if (!arOn) { camera.position.sub(shakeOff); }
}
camera.position.set(0, 5, 8);
renderer.setAnimationLoop(frame);
