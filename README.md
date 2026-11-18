<!-- SPDX-License-Identifier: CC0-1.0 -->

# voxel-rail

Co-op train game: gather wood and ore, craft track, lay it ahead of a
train that will not stop. Design decisions are in `docs/DESIGN.md`.

## Setup

Needs Node 24 or later (runs TypeScript directly).

```bash
npm install
```

## Play

```bash
node server/main.ts
```

Then open http://localhost:8080/ in a browser, one tab or computer per
player. The server builds the client into `web/` and serves it. Options:
`--port N`, `--host ADDR`, `--seed N` (level seed), `--no-static` (serve
`web/` with another web server instead; build it with `node tools/build.ts`).
Page options: `?name=NAME`, `?keys=NAME` (bindings from
`config/keys/NAME.json`), `?server=HOST:PORT`.

Controls: WASD or arrows to move, Space to act (pick up, drop, chop,
mine, lay track), B to boost, E for the emote menu (move keys pick,
Enter sends). Gamepad: left stick, X, Y, right stick press, right stick,
right trigger. Drag with the mouse to turn the camera.

## Libraries

Everything runs offline. three.js and ws are pinned and committed under
`vendor/` (see `vendor/README.md`); `npm install` only fetches the type
checker.

## Tuning values

All tuning values (game rules, train, server tick, level generator
defaults) are in `config/game.json`; each section's `_doc` describes its
keys. Command-line options override the generator defaults. Per-person
key bindings go in `config/keys/<name>.json` (see `config/keys/example.json`).

## Level generator

Generate a level and print it in the terminal:

```bash
node tools/genlevel.ts --seed 7
```

Show the generator's two forced routes instead of the cheapest path:

```bash
node tools/genlevel.ts --seed 7 --show routes
```

Write a Tiled map (`cells.tsj` and `cells.png` are written next to it):

```bash
node tools/genlevel.ts --seed 7 --out out/level7.tmj
```

Show the height level of every cell (in colour, lighter is higher; ramps
are arrows pointing uphill):

```bash
node tools/genlevel.ts --seed 7 --show height
```

Write the plain JSON level format:

```bash
node tools/genlevel.ts --seed 7 --json out/level7.json
```

Print and check a Tiled map, for example after editing it in Tiled:

```bash
node tools/render.ts out/level7.tmj
```

All options:

```bash
node tools/genlevel.ts --help
```

## Checks

```bash
npm run typecheck
```

```bash
npm test
```

## License

CC0 1.0 unless a file says otherwise. See `LICENSE`.
