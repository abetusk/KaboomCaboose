<!-- SPDX-License-Identifier: CC0-1.0 -->

# Assets

- `generated/`: terrain voxel models made by `tools/genassets.ts` (CC0).
  `manifest.json` lists every model with its kind, variant and stage.
- `third_party/kytric/`: Kytric's train, track, tree, stone, wood and bush
  models (CC0, see the LICENSE.md there).
- `third_party/kenney/`: Kenney's Mini Characters knight, zombie and robot
  (`.glb`, rigged and animated) and their shared `Textures/colormap.png`
  (CC0, see License.txt there; source https://kenney.nl/assets/mini-characters).
- `third_party/mehrasaur/`: model 10 of mehrasaur's Voxel Buildings,
  the source of the station building `generated/station-house.vox` (CC0,
  see the README.md there).
- `preview/`: preview images and `index.html`, a self-contained gallery.

Scale: one cell is 32 voxels across, one height level 16 voxels; the train
and wagons are Kytric's models scaled 2x. Axes x, y
horizontal, z up. Ramps and sloped track rise toward +x.

Regenerate (Kytric's extracted `vox` folder defaults to
`~/claude/models/kytric/vox`, Kenney's Mini Characters folder to
`~/claude/models/kenney`):

```bash
node tools/genassets.ts
```

The `.vox` files open in Goxel. Characters are one glTF unit per cell.
