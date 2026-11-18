// SPDX-License-Identifier: CC0-1.0
//
// To the extent possible under law, the authors have waived all copyright
// and related or neighboring rights to this work.
// https://creativecommons.org/publicdomain/zero/1.0/
//

// Screenshots of the running page from a headless Firefox (2026-11-16),
// to check how things look without a person at the screen:
//
//   node tools/shot.ts URL [--at 3,6] [--size 1280x800] [--out shots/name] [--js CODE]
//   node tools/shot.ts --quit
//
// It starts Firefox headless with a profile of its own (shots/profile, in
// the project: the snap Firefox cannot read /tmp), drives it over
// Marionette (Firefox's own remote control, on port 28281), opens URL and
// saves a PNG at each of the --at times in seconds (default 6), named
// <out>-<seconds>s.png (default out: shots/shot). --js runs CODE in the
// page just before each screenshot (to move the camera, say); whatever
// it leaves in window.shotOut is printed at the end. Firefox is
// then told to quit over Marionette (the snap Firefox does not take
// signals from outside it); --quit only does that, for one left running. With a server started with --dev, an address such as
//
//   http://127.0.0.1:8090/?create=test&dev=arrive,offer:dynamiteWagon
//
// makes a test room and goes straight to its first station's offers.
//

import { spawn } from "node:child_process";
import { connect, type Socket } from "node:net";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = join(dirname(new URL(import.meta.url).pathname), ".."),
      PORT = 28281;

function opt(name: string, def: string): string {
  const i = process.argv.indexOf("--" + name);
  return ( (i >= 0) ? process.argv[i + 1] : def );
}

const url  = process.argv[2],
      at   = opt("at", "6").split(",").map(Number),
      [sw, sh] = opt("size", "1280x800").split("x").map(Number),
      out  = opt("out", join(ROOT, "shots", "shot")),
      js   = opt("js", ""),
      prof = join(ROOT, "shots", "profile");
const quitOnly = process.argv.includes("--quit");
if ( !quitOnly && ( !url || url.startsWith("--") ) ) {
  console.error("usage: node tools/shot.ts URL [--at 3,6] [--size 1280x800] [--out shots/name] [--js CODE]");
  process.exit(1);
}
mkdirSync(prof, { recursive: true });
mkdirSync(dirname(out), { recursive: true });
if (!existsSync(join(prof, "user.js"))) {
  writeFileSync(join(prof, "user.js"), [
    'user_pref("marionette.port", ' + PORT + ');',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
  ].join("\n") + "\n");
}

if (!quitOnly) {
  const ff = spawn("firefox", ["--headless", "--marionette", "-no-remote", "-profile", prof, "--window-size=" + sw + "," + sh],
                   { stdio: "ignore", detached: true });
  ff.on("error", () => { });
  ff.unref();
}
const sleep = (ms: number) => new Promise(ok => setTimeout(ok, ms));

// Marionette: messages are "<length>:<json>"; a command is
// [0, id, name, params], its answer [1, id, error, result].
//
let sock: Socket | null = null, buf = "", next = 1;
const waiting = new Map<number, (m: [number, number, unknown, unknown]) => void>();
let hello: () => void = () => { };

function onData(d: Buffer): void {
  buf += d.toString("utf8");
  for (;;) {
    const c = buf.indexOf(":");
    if (c < 0) { return; }
    const n = Number(buf.slice(0, c));
    if ( (buf.length - c - 1) < n ) { return; }
    const msg = JSON.parse(buf.slice(c + 1, c + 1 + n));
    buf = buf.slice(c + 1 + n);
    if (!Array.isArray(msg)) { hello(); continue; }
    waiting.get(msg[1])?.(msg as [number, number, unknown, unknown]);
  }
}

function cmd(name: string, params: object = {}): Promise<unknown> {
  const id = next++, text = JSON.stringify([0, id, name, params]);
  return new Promise((ok, bad) => {
    waiting.set(id, m => { waiting.delete(id); if (m[2]) { bad(new Error(name + ": " + JSON.stringify(m[2]))); } else { ok(m[3]); } });
    sock!.write(Buffer.byteLength(text) + ":" + text);
  });
}

async function main(): Promise<void> {
  for (let k = 0; ; k++) {
    try {
      await new Promise<void>((ok, bad) => {
        const s = connect(PORT, "127.0.0.1");
        sock = s;
        s.on("data", onData);
        hello = ok;
        s.on("error", bad);
      });
      break;
    }
    catch (e) {
      if (k > 60) { throw new Error("Firefox did not open Marionette on port " + PORT); }
      await sleep(500);
    }
  }
  await cmd("WebDriver:NewSession", { capabilities: {} });
  if (quitOnly) { return; }
  await cmd("WebDriver:SetWindowRect", { width: sw, height: sh });
  await cmd("WebDriver:Navigate", { url });
  const t0 = performance.now();
  for (const s of at) {
    await sleep(Math.max(0, (s * 1000) - (performance.now() - t0)));
    if (js) { await cmd("WebDriver:ExecuteScript", { script: js, args: [] }); }
    const r = await cmd("WebDriver:TakeScreenshot", { full: false }) as { value: string };
    const file = out + "-" + s + "s.png";
    writeFileSync(file, Buffer.from(r.value, "base64"));
    console.log("saved", file);
  }
  const log = await cmd("WebDriver:ExecuteScript", { script: "return document.getElementById('hud')?.textContent ?? '';", args: [] }) as { value: string };
  console.log("status box:\n" + log.value);
  const said = await cmd("WebDriver:ExecuteScript", { script: "return String(window.shotOut ?? '');", args: [] }) as { value: string };
  if (said.value) { console.log("shotOut:\n" + said.value); }
}

try {
  await main();
}
finally {
  try { await cmd("Marionette:Quit", { flags: ["eForceQuit"] }); } catch { }
  (sock as Socket | null)?.destroy();
}
