<!-- SPDX-License-Identifier: CC0-1.0 -->

# Sound effects

Copied unchanged on 2026-11-20 from the project owner's sound library
(`~/claude/models/soundlib`), for the sounds the game plays
(`src/client/sound.ts`, D11b). Which file plays when is set in
`config/sounds.json`; the table below is how it is set as of
2026-11-20.

Source and licence are not recorded: the library holds no licence file
and the files carry no source tags. Check them before publishing.

| File | Plays |
|---|---|
| `train_horn.mp3` | the train starting; more and more often as it nears the end of the track; a character boosting into it |
| `chug_loop.mp3` | looped while the train runs |
| `explosion.mp3` | the train crashing; dynamite going off |
| `rub.mp3` | a bridge or a stair built |
| `mine0.mp3` to `mine3.mp3` | one at random each time a pickaxe strikes |
| `wood0.mp3` to `wood5.mp3` | the same while a character chops |
