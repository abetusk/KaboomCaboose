<!-- SPDX-License-Identifier: CC0-1.0 -->

# Testing on a headset

How to run the client on a Meta Quest during development, from this Linux
machine (Ubuntu 24.04).

## Why a secure page is needed

WebXR is available only in a secure context. The WebXR spec marks
`navigator.xr` and the session interfaces `[SecureContext]`
(`immersive-web/webxr`, `index.bs`, checked 2026-11-11).

`http://localhost` counts as a secure context, so a page reached as
`localhost` needs no certificate. (From the Secure Contexts spec; not
checked here.)

## Option 1: USB port forwarding (default for development)

The headset reaches the dev machine's ports as its own `localhost`.

### One-time setup on the Linux machine

Install adb and the Android udev rules:

```bash
sudo apt install adb android-sdk-platform-tools-common
```

The user must be in the `plugdev` group (true for user `z` as of
2026-11-11).

If `adb devices` shows the headset as "no permissions", add a udev rule for
Meta's USB vendor ID and replug the headset:

```bash
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="2833", MODE="0660", GROUP="plugdev"' | sudo tee /etc/udev/rules.d/51-meta-quest.rules && sudo udevadm control --reload-rules
```

Not verified: whether `android-sdk-platform-tools-common` already covers
vendor ID `2833`.

### One-time setup on the headset

1. Enable developer mode for the headset in the Meta Horizon phone app.
2. Connect the headset by USB and accept "Allow USB debugging" inside the
   headset.

### Each session

1. Check the headset is connected:

   ```bash
   adb devices
   ```

2. Start the game server on this machine. It serves the page and the
   game connection on one port, 8080.

   ```bash
   cd ~/claude/voxel-rail && node server/main.ts
   ```

3. Make the headset's own port 8080 reach this machine. The command
   returns at once; `adb reverse --list` shows the forwarding.

   ```bash
   adb reverse tcp:8080 tcp:8080
   ```

4. In the Quest browser, open `http://localhost:8080`, join a room in
   the lobby (or open `http://localhost:8080/?room=CODE` to join that
   room at once), and press START AR at the bottom of the page.

Forwarding lasts until the headset is unplugged or adb restarts.

### When the connection breaks

The page on the headset says it is disconnected, or does not load.

1. List the forwarded ports. `tcp:8080 tcp:8080` should be there.

   ```bash
   adb reverse --list
   ```

2. If it is not, check the headset is still listed as `device` (not
   `unauthorized` or `offline`):

   ```bash
   adb devices
   ```

3. Forward the port again:

   ```bash
   adb reverse tcp:8080 tcp:8080
   ```

4. To start the forwarding over, remove all of it, then forward again
   as in step 3:

   ```bash
   adb reverse --remove-all
   ```

5. If the headset shows as `unauthorized` or `offline`, unplug and plug
   it back in and accept the prompt in the headset. If that does not
   help, restart adb, then go back to step 2:

   ```bash
   adb kill-server
   ```

## In AR

- Look at the table: a yellow ring shows where the board will rest, its
  near edge toward you. Hold your gaze there for a second (the ring
  widens) and it settles; a trigger press, a pinch or a grab puts it
  down at once.
- Squeeze (controller grip) or pinch (hand tracking) with one hand to
  drag the level along the board; while holding one grip, the right
  thumbstick slides the view too (push right to see further right);
  left thumbstick press drops the drag, left Y steps
  what the board follows (train, your character, nothing). With both
  hands, carry, turn and resize the board.
- Left thumbstick walks (up = away from you across the board), right A
  is the action, right B boosts, holding left X fast-forwards the train; right thumbstick press opens the emote menu, the
  right thumbstick picks and the right trigger sends (D3.6). With the
  menu closed, the left and right triggers step to the previous and next
  tool, as [ and ] do on the keyboard.
- Lit dynamite: hold right A to aim, and tilt the right controller to
  set the distance: pointing down at the board (45 degrees or more) is
  the shortest throw, one cell; raising it toward level reaches farther,
  up to the full range at level. The dots and ring show where it will
  land; let go of A to throw. A quick tap still puts it down at your
  feet. The angles are `input.throwPitch` in `config/game.json`.
- Starting AR from the lobby, and the end of a run, put you in the
  walk-in lobby (D7.6a): stand in a circle until its pie fills to take a
  character, make a run (NEW) or join an open room (JOIN). Without a
  headset, `http://localhost:8080/?lobby` opens it on the page.
- To leave AR, open the headset's system menu with the Meta button and
  exit the page's session there (from memory, not checked on a headset).

## Option 2: local HTTPS over the network

For testing several devices at once without cables.

1. Serve the client over HTTPS with a locally generated certificate
   (mkcert, or Vite's basic-ssl plugin). mkcert is not installed on this
   machine as of 2026-11-11.
2. Open the page from the headset by the machine's LAN address. The
   headset must trust the local certificate authority, or the user clicks
   through a warning.
3. The game server must use `wss://`. An HTTPS page cannot open a plain
   `ws://` connection.

## Option 3: public tunnel

A tunnel service (for example Cloudflare Tunnel) gives a real HTTPS
address with no certificate setup. All traffic passes through the third
party.

## Without a headset

Meta's Immersive Web Emulator browser extension simulates a headset in
desktop Chrome. Useful for game logic and input mapping. It does not test
passthrough, plane detection, or real headset performance.

## Quick testing: the test run, dev mode and screenshots

The test run is a difficulty in the lobby, "test". It makes a few short
hand-made levels: flat, no black rock, grey rock along the top edge,
trees along the bottom, 10 cells of track to lay from one station to the
next (a level is 24 cells long; its length field is off), and two piles
of 10 track beside each station. The train starts with the dynamite
wagon at its back, holding one stick (taken with empty hands beside
it), as if its upgrade had been taken, so the dynamite upgrades can be
offered from the first station. Two cells of track behind the first
station hold the longer train. Picking it sets 4 levels. A level takes
moments to lay, so stations, upgrades, wagons and dynamite can be tried
out quickly.

Dev mode adds shortcuts. Start the server with `--dev`:

```bash
cd ~/claude/voxel-rail && node server/main.ts --dev
```

The settings panel (top right) then has a "dev" box at its top:

- Arrive: lay straight track to the end station and arrive (only where
  that is a straight row, as in the test run); the upgrades are offered.
- Offer: put the chosen upgrade among the offers.
- Give: put something in your hands: wood, ore, track, a stick, a lit
  stick, or a wagon.
- Add wagon: add a wagon at the back of the train.
- Fill wagons: wood, ore, track and sticks to the brim.
- Skip to level N, and Crash.
- `take:KIND` (address only, below): take an upgrade at once, as if
  picked, to see how it looks (several times for its higher levels).

The same work from the page's address, which is handy for repeating a
situation after a reload:

- `?create=test`: make a room of that difficulty (4 levels, or
  `&levels=N`) and join it.
- `&dev=arrive,offer:dynamiteWagon,stand:0`: shortcuts sent once the
  level arrives (`stand:N` moves you into offer N's circle).

For example,
`http://localhost:8080/?create=test&dev=arrive,offer:dynamiteWagon`
opens straight on the first station's offers. The commands are listed
in `server/dev.ts`. Without `--dev` the server ignores them.

Screenshots without a person at the screen (for Claude to check how
things look): `tools/shot.ts` starts a headless Firefox with its own
profile in `shots/` (ignored by git), opens an address, and saves PNGs
at the given seconds, printing the status box:

```bash
node tools/shot.ts "http://127.0.0.1:8090/?create=test&dev=arrive" --at 5,8 --out shots/arrive
```

It closes Firefox when done; `node tools/shot.ts --quit` closes one left
running. `--js CODE` runs in the page before each shot; on a dev server
the page has `voxelRail` (the camera, its controls and the characters)
for aiming the camera, and whatever CODE puts in `window.shotOut` is
printed. A close look at your own character from behind, for instance:

```bash
node tools/shot.ts "http://127.0.0.1:8090/?create=test&dev=take:carry,take:speed" --at 6,7 --out shots/gear --js 'const v=voxelRail, a=v.avatars.get(v.me()), p=a.root.getWorldPosition(v.camera.position.clone()); v.orbit.target.set(p.x, p.y+0.4, p.z); v.camera.position.set(p.x-1.2, p.y+1.4, p.z-1.6);'
```

The second shot shows the new view. It needs a server running with `--dev` for the `dev=` part.

## Slower networks

The server can add delay to every message to mimic a real connection
(D7.7). `--latency` is each way, so a round trip takes twice it;
`--jitter` adds a random 0 to that many more milliseconds per message,
keeping the order. For example, about a 100 ms round trip with some
wobble:

```bash
cd ~/claude/voxel-rail && node server/main.ts --latency 50 --jitter 20
```

The start-up line repeats the delay in use. Your own character's moves, pickups,
presses, tool changes and hits should show as without delay (D7.4);
others and the train run about 0.1 s behind the server.

## Not verified

The `adb reverse` workflow and the emulator's capabilities are described
from memory, not checked against Meta's documentation.
