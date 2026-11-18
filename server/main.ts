// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// The game server (D7, D13.1). One command runs everything:
//
//   node server/main.ts [--port 8080] [--host 0.0.0.0] [--seed N] [--no-static]
//                       [--latency MS] [--jitter MS] [--help]
//
// It builds the client into web/, serves it over HTTP, and runs the
// authoritative simulation, talking to browsers over a WebSocket at /ws.
// Games run in rooms (server/room.ts, D7.6); a page that names no room
// joins the first one.
// With --no-static it only runs the game; serve web/ with any static web
// server (build it with `node tools/build.ts`) and the page connects to
// ws://<page host>:<port>/ws, or to the server named by ?server=host:port.
//
// --latency holds every message, both ways, for that many milliseconds,
// so a round trip takes twice it; --jitter adds a random 0 to that many
// more per message, keeping the order (server/lag.ts, D7.7). Both are 0
// by default.
//

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, dirname } from "node:path";
import { WebSocketServer, type WebSocket } from "../vendor/ws/wrapper.mjs";
import { CONFIG } from "../src/config.ts";
import { NO_INPUT, TOOL_PREV, type Input } from "../src/sim/game.ts";
import { EMOTES, ROOM_LIMITS, type ClientMsg, type RoomDefaults } from "../src/net/protocol.ts";
import { build } from "../tools/build.ts";
import { Lag } from "./lag.ts";
import { Room, send, QUEUE_MAX, type Client } from "./room.ts";
import { DIFFICULTIES, DEFAULT_DIFFICULTY } from "./difficulty.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

function arg(name: string, def: string): string {
  const i = process.argv.indexOf("--" + name);
  return ( (i >= 0) ? process.argv[i + 1] : def );
}

// --help (or -h): what the options do, then exit without starting.
//
const HELP = `voxel-rail game server: builds the client into web/, serves it over
HTTP and runs the game over a WebSocket at /ws.

usage: node server/main.ts [options]

  --port N        port for the page and the game (default 8080)
  --host ADDR     address to listen on (default 0.0.0.0, all)
  --seed N        first room's first level seed (default random); later
                  levels count up; other rooms start from a random seed
  --no-static     run only the game, not the page; serve web/ yourself
                  (build it with: node tools/build.ts)
  --latency MS    made-up delay on every message, each way (default 0);
                  a round trip takes twice it
  --jitter MS     random extra 0 to MS per message, order kept (default 0)
  --dev           take development shortcuts (arrive at the station, give
                  items, add wagons, skip levels, crash; server/dev.ts),
                  from the settings panel's Dev buttons or ?dev= in the
                  page's address
  -h, --help      show this and exit

Game settings are in config/game.json.`;

if ( process.argv.includes("--help") || process.argv.includes("-h") ) {
  console.log(HELP);
  process.exit(0);
}

const PORT       = Number(arg("port", "8080")),
      HOST       = arg("host", "0.0.0.0"),
      STATIC     = !process.argv.includes("--no-static"),
      LATENCY    = Number(arg("latency", "0")),
      JITTER     = Number(arg("jitter", "0")),
      DEV        = process.argv.includes("--dev"),

      SEED       = Number(arg("seed", String(1 + Math.floor(Math.random() * 1e6)))),

      WEB        = join(ROOT, "web");

for (const [k, v] of [["latency", LATENCY], ["jitter", JITTER]] as const) {
  if ( !Number.isFinite(v) || (v < 0) ) { console.error("--" + k + " wants a number of milliseconds, 0 or more"); process.exit(1); }
}

// ---- static files ----

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".vox": "application/octet-stream", ".glb": "model/gltf-binary",
  ".css": "text/css", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url  = new URL(req.url ?? "/", "http://x"),
        path = normalize(join(WEB, decodeURIComponent(url.pathname)));
  if (!path.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try {
    const f = ( (await stat(path)).isDirectory() ? join(path, "index.html") : path );
    res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(await readFile(f));
  }
  catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
}

// ---- rooms ----

// Room codes: four letters, leaving out I and O (read as 1 and 0).
//
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

// A room other than the first is closed once it has been empty this
// many seconds.
//
const ROOM_IDLE = 300;

function newCode(rooms: Map<string, Room>): string {
  for (;;) {
    let s = "";
    for (let k = 0; k < 4; k++) { s += LETTERS[Math.floor(Math.random() * LETTERS.length)]; }
    if (!rooms.has(s)) { return s; }
  }
}

const randomSeed = () => ( 1 + Math.floor(Math.random() * 1e6) );

// A new room's starting values: 12 levels, the file's level size and the
// default difficulty set.
//
const DEFAULT_LEVELS = 12;

function roomDefaults(): RoomDefaults {
  const gen = CONFIG.levelgen as { width: number, length: number };
  return { levels: DEFAULT_LEVELS, width: gen.width, length: gen.length, difficulty: DEFAULT_DIFFICULTY };
}

function onMessage(rooms: Map<string, Room>, first: Room, c: Client, data: string): void {
  let m: ClientMsg;
  try { m = JSON.parse(data); } catch { return; }
  const name = () => String((m as { name?: unknown }).name ?? "player").slice(0, 24);
  if (m.t === "hello") {
    const code = ( (typeof m.room === "string") ? m.room.trim().toUpperCase() : "" ),
          room = ( code ? rooms.get(code) : first );
    if (!room) { send(c, { t: "error", text: "no room " + code }); return; }
    room.join(c, name());
  }
  else if (m.t === "create") {
    const code = newCode(rooms), def = roomDefaults(),
          pick = (v: unknown, lim: readonly [number, number], d: number) =>
                 ( Number.isFinite(v) ? Math.max(lim[0], Math.min(lim[1], Math.round(v as number))) : d );
    const opts = {
      name       : ( String(m.room ?? "").trim().slice(0, 32) || ("Room " + code) ),
      open       : (m.open === true),
      levels     : pick(m.levels, ROOM_LIMITS.levels, def.levels),
      width      : pick(m.width,  ROOM_LIMITS.width,  def.width),
      length     : pick(m.length, ROOM_LIMITS.length, def.length),
      difficulty : ( DIFFICULTIES.includes(m.difficulty ?? "") ? m.difficulty! : def.difficulty ),
    };
    const cells = opts.levels * opts.width * opts.length;
    if (cells > ROOM_LIMITS.cells) {
      send(c, { t: "error", text: "too big: levels x width x length is " + cells + ", at most " + ROOM_LIMITS.cells });
      return;
    }
    let room: Room;
    try {
      room = new Room(code, opts, randomSeed());
    }
    catch (e) {
      send(c, { t: "error", text: "could not make a run with those options: " + (e as Error).message });
      return;
    }

    // Every room takes development shortcuts when the server does (the
    // first room carries the server's --dev).
    //
    room.dev = first.dev;
    rooms.set(code, room);
    const i = room.info();
    console.log("room", code, "made:", i.name, ( i.open ? "(open)," : "(by code),"), i.levels, "levels,", i.width + "x" + i.length + ",", i.difficulty);
    room.join(c, name());
  }
  else if (m.t === "list") {
    send(c, { t: "rooms", rooms: [...rooms.values()].filter(r => r.open).map(r => r.info()), difficulties: DIFFICULTIES,
              defaults: roomDefaults() });
  }
  else if (m.t === "leave") {
    c.room?.leave(c);
  }
  else if (m.t === "dev") {
    c.room?.devCommand(c, m.cmd);
  }
  else if (m.t === "set") {
    c.room?.set(m.section, m.key, m.value);
  }
  else if (m.t === "restart") {
    if (c.room) { console.log("[" + c.room.code + "] run restarted from the settings panel"); c.room.restart(); }
  }
  else if (m.t === "input") {
    const num = (v: unknown) => ( (typeof v === "number") && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0 );
    const inp: Input = {
      mx: num(m.mx), my: num(m.my), action: (m.action === true), boost: (m.boost === true),
      emote: ( ( Number.isInteger(m.emote) && (m.emote >= 0) && (m.emote < EMOTES.length) ) ? m.emote : -1 ),
      tool: ( ( Number.isInteger(m.tool) && (m.tool >= 0) && (m.tool <= TOOL_PREV) ) ? m.tool : -1 ),
      fast: (m.fast === true),
    };
    if (!c.room) { return; }
    if (c.queue.length >= QUEUE_MAX) { c.queue.shift(); }
    c.queue.push({ seq: ( Number.isInteger(m.seq) ? m.seq! : c.ack ), inp });
  }
}

// ---- start ----

// Start the server; resolves with the port it listens on and a function
// to stop it (dropping open connections, so a failed test does not hang
// on them). Tests start it on port 0 (any free port). Each call has
// rooms of its own; the first room (which a client joins when it names
// none) starts from --seed. `idle`: seconds an empty room other than the
// first is kept.
//
export function startServer(port = PORT, host = HOST, serveFiles = STATIC,
                            net = { latency: LATENCY, jitter: JITTER },
                            idle = ROOM_IDLE, dev = DEV): Promise<{ port: number, close: () => void }> {
  if (serveFiles) { console.log("built client:", build(WEB)); }
  const rooms = new Map<string, Room>(),
        first = new Room(newCode(rooms), { name: "Main", open: true, levels: DEFAULT_LEVELS, difficulty: DEFAULT_DIFFICULTY }, SEED, true);
  first.dev = dev;
  rooms.set(first.code, first);
  if (dev) { console.log("development shortcuts on (--dev)"); }
  console.log("first room:", first.code);
  let nextId = 1;
  const sockets = new Set<WebSocket>();

  const http = createServer((req, res) => {
    if (serveFiles) { void serveStatic(req, res); }
    else            { res.writeHead(404).end("static files are not served (--no-static)"); }
  });
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  wss.on("connection", (ws: WebSocket) => {
    const c: Client = { ws, id: nextId++, up: new Lag(net.latency, net.jitter), down: new Lag(net.latency, net.jitter),
                        room: null, queue: [], held: { ...NO_INPUT }, ack: 0 };
    sockets.add(ws);
    let gone = false;
    ws.on("message", (d: unknown) => {
      const text = String(d);
      c.up.run(() => { if (!gone) { onMessage(rooms, first, c, text); } });
    });
    ws.on("close", () => { gone = true; sockets.delete(ws); c.up.clear(); c.down.clear(); c.room?.leave(c); });
  });

  // Every room runs, players or not (D6.9); a room other than the first
  // goes once its run has ended, or once it has been empty `idle`
  // seconds.
  //
  const timer = setInterval(() => {
    const now = Date.now();
    for (const r of [...rooms.values()]) {
      const empty = ( (r !== first) && (r.emptyWall >= 0) && ((now - r.emptyWall) >= (idle * 1000)) );
      if ( r.closed || empty ) {
        rooms.delete(r.code);
        console.log("room", r.code, ( r.closed ? "closed (run ended)" : "closed (empty)" ));
        continue;
      }
      r.tick();
    }
  }, 1000 / CONFIG.server.tickHz);
  return new Promise(ok => {
    http.listen(port, host, () => {
      const a = http.address(), p = ( (a && (typeof a === "object")) ? a.port : port );
      ok({ port: p, close: () => {
        clearInterval(timer);
        for (const ws of sockets) { ws.terminate(); }
        wss.close();
        http.close();
      } });
    });
  });
}

if (import.meta.url === ("file://" + process.argv[1])) {
  const { port } = await startServer();
  console.log("voxel-rail server on http://" + HOST + ":" + port + "/ (WebSocket /ws)" + ( STATIC ? "" : ", static files off" ) +
              ( ( (LATENCY > 0) || (JITTER > 0) ) ? (", made-up delay " + LATENCY + " ms + 0-" + JITTER + " ms each way") : "" ));
}
