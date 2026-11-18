<!-- SPDX-License-Identifier: CC0-1.0 -->

# Design decisions

Working name: voxel-rail (placeholder).

A co-op game where players gather resources, craft track, and lay it ahead
of a train that advances on its own. Web client for desktop and AR headsets,
one central server.

Each entry has a status. **Decided** entries were set by the project owner.
**Proposed** entries are recommendations not yet confirmed. **Open** entries
still need a choice. **Deferred** entries are wanted later and the design
must leave room for them now.

## 1. Client platform

**D1.1 Decided.** The client is a web application.

**D1.2 Decided.** One client codebase with two modes, desktop and AR. Both
render the same scene. The modes differ only in camera and input.

**D1.3 Decided.** Rendering uses three.js with WebXR.

**D1.4 Decided.** The project is written in TypeScript.

**D1.5 Decided.** Game logic is a TypeScript module with no rendering or
network dependencies. The renderer reads game state and draws it. The same
logic module runs on the server and the client (isomorphic code).

## 2. Board view

**D2.1 Decided.** The level is a long strip. The client shows only a window
over the strip. The window's width and height are a settable parameter. The window moves with the
player, in the style of Populous.

**D2.2 Decided.** Content outside the window is always clipped (clipping planes or
stencil), so the board has clean edges on a table in AR.

**D2.3 Decided.** The view follows the local player's avatar by default.
Each player has their own view. In AR the view is the board window on the
table.

**D2.4 Decided.** An optional free camera mode lets the player move the
view freely. When the player stops controlling it, the view snaps back to
following their avatar.

**D2.5 Decided.** When another player's avatar is outside the visible
slice of the level, a small player silhouette with an arrow is shown at
the edge of the view, pointing toward that player. As built: any
character outside the window, one's own included, shows as an arrow on
the window's edge at its row and height, pointing out toward it, over a
faint disc on the edge; yellow for one's own character, white for the
others, pulsing gently. No silhouette yet.

**D2.7 Decided.** The camera orbits (left drag), zooms (wheel) and pans
(right drag). A pan is kept as an offset from the followed character
until the player presses the camera-snap key (`input.keyboard.cameraSnap`,
C; gamepad back/view button), which moves the view back onto the
character and keeps rotation and zoom; the camera never snaps back by
itself. Three camera modes, stepped through with the camera-mode key
(`input.keyboard.cameraMode`, V; gamepad start/menu): follow the train
(the middle car; the default), follow one's own character, and free
(stays put; snap jumps it to the character). The browser remembers the
mode. The clipped window follows the camera's centre.

**D2.8 Decided.** A bloom filter makes the brightest parts of the
picture glow (`view.bloom`, with strength, radius and threshold in
`view`; three.js UnrealBloomPass).

**D2.9 Decided.** The character faces its direction of travel at any
angle: eight ways on keys, any way on a stick. The sim keeps a heading
(the last walk direction) next to the four-way facing that picks target
cells; the client turns the avatar to the heading the short way round,
quickly but over a few frames. A boost goes along the heading.

**D2.10 Decided.** Starting a boost kicks a small, faint puff of dust
from the character's feet, behind its heading: five pale balls that
drift back, grow a little and are gone within half a second.

**D2.6 Open.** How long the free camera waits without input before
snapping back, and whether the snap is instant or animated.

## 3. Cameras and input

**D3.1 Decided.** Desktop mode uses an orbit or isometric camera over the
board window. The camera can rotate around the board.

**D3.2 Decided.** AR mode places the board on a real table in the user's
environment, using passthrough (`immersive-ar` session).

**D3.3 Decided.** In AR, the avatar is controlled with the controller
thumbstick.

**D3.4 Decided.** In AR, hand tracking is used only to manipulate the board:
reposition, rotate, resize. It is not used for avatar control.

**D3.5 Decided.** Table placement is left to the implementer. Plan: use
WebXR plane detection where the device offers it, fall back to hit-test,
and keep the board fixed with a WebXR anchor where supported. All game
content sits under one root node, so placing, rotating, and scaling the
board is a single transform.

**D3.6 Decided.** Controls. Keyboard, gamepad and the AR controllers do
the same things:

| Action | Keyboard | Gamepad / AR controllers |
| --- | --- | --- |
| Move | WASD or arrow keys | left thumbstick |
| Action: pick up, drop, chop, mine, place track | Space | X; in AR A (right controller) |
| Boost | B | Y; in AR B (right controller) |
| Fast-forward (hold) | F | left bumper; in AR X (left controller) |
| Open / close emote menu | E (proposed) | right thumbstick press |
| Pick emote in the menu | move keys (proposed) | right thumbstick |
| Send picked emote | Enter (proposed) | right trigger |
| Previous / next tool | [ / ] | d-pad left / right or left / right trigger; in AR left / right trigger (the right trigger sends instead while the emote menu is open) |

While the emote menu is open on the keyboard, the move keys pick the
emote and the character stands still (proposed).

**D3.7 Decided.** Boost can be used at most once per cooldown, 2 s
(parameter).

**D3.8 Decided.** All bindings live in the `input` section of
`config/game.json`. Keys use the browser's physical key codes (`KeyW`
is the key in the W position on any keyboard layout). Per-person
bindings: a person writes the bindings they want to change into
`config/keys/<name>.json` and opens the game with `?keys=<name>`; their
bindings replace the defaults action by action, and the browser
remembers the choice for next time. This keeps D6.1 (no menus) and
needs nothing but a file.

**D3.9 Decided.** AR mode as built (`src/client/ar.ts`,
`src/client/board.ts`). The page shows a START AR button when the
browser offers `immersive-ar`. Placing: the board follows where the
viewer looks, resting on the real surface there by WebXR hit test, its
south edge (the level's +y side) turned to the viewer, with a
"Look at a table to place the board" label over it. It settles by
itself once the aim (the ring under it) has stayed within 5 cm for 1 s,
the ring widening as the wait runs; a trigger press or a pinch puts it
down at once, and a grab (squeeze or pinch) puts it down and goes on as
a grab. Without hit test it floats 0.6 m in front of
the viewer and 0.45 m below the eyes. A WebXR anchor holds it where the
device has anchors. Plane detection is not used; on a device whose hit
test already uses detected surfaces it adds nothing. Moving: a pinch
(hand tracking) or a squeeze (controller grip) grabs. One grab drags the
level along the board under the hand, as a right-button drag pans on
the page; the drag is kept as an offset from what the camera mode
follows until the camera-snap control (left X) drops it, and the
camera-mode control (left Y) steps what the board follows. Two grabs
carry the board, turn it about the vertical and resize it about the
point between the hands; letting go of the second anchors it again. Size: one cell
is `view.arCellSize` metres when first placed (0.02), kept within 4 mm
to 20 cm. The visible window is `view.arWindowCells` cells (32) along x;
the board stays still and the level slides under it, keeping what the
camera mode follows in the middle, not running past the level's ends.
Up on the thumbstick walks the way the viewer looks across the board.
Names, emotes, the emote menu, the start label and the level-end message
are drawn as sprites over the board (page HTML is not shown in the
headset); the development read-out and the settings panel are page only.
Bloom is off in AR. The squeeze is taken by grabbing, so it is not
offered as an `input.xr` control.

## 4. Height and terrain

**D4.1 Decided.** The world is 2.5D. Terrain is a heightmap with a few
discrete levels and one walkable surface per cell. Bridges and overpasses
add a deck above the ground. Tunnels add a passage below it.

**D4.2 Decided.** Track is laid only on the ground surface (including
ramps, bridges and tunnels as track pieces). Track extends from the current
track end at that end's height. Players choose where track goes, not how
high.

**D4.3 Decided.** Avatars interact only with cells on their own level.

**D4.6 Decided** (revised 2026-11-12). Every height change without a ramp
is a sheer face. Avatars walk up and down only by ramps. Sheer edges have
guard rails: a normal walk never goes over one.

**D4.7 Decided.** Ramps are built by players, not generated. A player
places one mined grey rock to make a ramp. The ramp's cell must sit on
ground, grey rock, black rock or bridge, and the ramp must abut a sheer
face one level up whose top is ground, grey rock, black rock or bridge.
The ramp is oriented toward that face. Placed ramps are permanent. The
cell at the top may hold a tree or grey rock: a character standing on
the ramp, facing up it, can chop or mine that cell.

**D4.8 Decided.** From a ledge, players place wood to build a bridge at the
ledge's height over lower ground, as over water. Bridges are permanent.

**D4.9 Decided.** Boost. A boost button gives a short speed boost.
Boosting toward a sheer drop pushes the avatar past the guard rail. A
one-level drop is survived. A drop of more than one level kills the
avatar, which respawns at a random location near the train (D6a.31).

**D4.10 Decided.** Black rock regions rise toward their interior, so
large black rock areas read as mountains.

**D4.11 Decided.** The top of black rock is walkable, by avatars and by
track. Black rock cannot be mined, but it can be climbed with ramps.

**D4.12 Decided.** Track can be laid on ramps and on bridges. The train
cannot drop off a ledge, so every level change on the track, up or down,
needs a ramp.

**D4.13 Decided.** Bridges have no maximum length.

**D4.14 Decided.** Avatars can step onto a ramp from its sides as well as
its low end. Track must run along the ramp: it enters at the low end,
where the ramp meets the lower ground, and leaves at the high end.

**D4.15 Decided.** Characters can walk on top of grey rock. A grey rock
block stands one level tall, so its top is one level above its cell:
level with a ridge one level up, a wall from the ground at its foot. The
usual height rules apply to these standing heights (equal height, ramps,
one-level drops by boost, two-level falls kill), and a block mined from
under a character drops them one level. Grey rock can be mined from
beside its foot or from beside its top (on a neighbouring rock or
ledge). Nothing is built, dropped or laid on rock tops. So from a ridge
over a plateau of rock a player walks out, mines a hole, boosts down
into it, mines on, and builds a ramp back up.

**D4.4 Decided.** A tunnel is ground cut away so the track runs through
higher terrain, level or as a ramp. Avatars can walk through a tunnel and
on the track cells inside it, as anywhere else on their level. Visibility
inside is handled by D5.1 and D5.2.

**D4.5 Deferred.** A player mechanic to raise terrain (dirt mound, slope)
that the train can climb like natural terrain. Not in the first rounds.
To leave room for it:
- cell height is mutable runtime state, changed through the same
  "tile changed" message as any other cell change;
- track slope is derived from terrain heights, not stored as a fixed
  attribute of the track piece;
- terrain meshes can be rebuilt per chunk when a height changes.

**D4.15 Decided.** Trees and grey rock can stack: a column may hold
several tree or grey rock blocks above its base. A block can be chopped or
mined only if no tree or grey rock block sits on top of it. Two-high grey
rock is mined from the top: from level 1 mine the upper block, carry its
debris away, then from level 0 mine the lower block.

**D4.16 Decided.** Chopping and mining show progress. A forest cell thins
out as it is chopped. Grey rock shows progress without changing shape
(proposed: cracks spreading), so it stays walkable until the last hit.

**D4.17 Decided.** Every terrain type (ground, forest, grey rock, black
rock) has purely visual variation between cells, while each type stays
clearly recognisable.

## 5. Visibility

**D5.1 Decided.** An avatar hidden from the current eye point is always
drawn as a silhouette through the occluding geometry.

**D5.2 Decided.** An optional "peep" mode cuts away the geometry inside a
cylinder from the eye to the local avatar, with a faded edge, so the
player can see the avatar's immediate surroundings.

**D5.3 Proposed.** Silhouette is a second avatar draw pass with the depth
test reversed. The peephole discards fragments that are nearer to the eye
than the avatar and inside a screen-space circle around the avatar, with
a dithered fade at the circle edge.

## 6. Game flow

**D6.1 Decided.** Everything happens in the game world. No menus, no cut
scenes.

**D6.2 Decided.** A level runs from a start station to a destination
station.

**D6.3 Decided.** Train upgrades are offered at the destination station as
objects. Players pick them up and place them on the train.

**D6.4 Decided** (2026-11-16, replacing a loop back to the first
station). A game is a run of levels (number chosen when the room is made,
default 12) strung together in one world: each level's end station is the
next level's start station, and players can see all of it. The train
stops at each station it reaches; after the station countdown the next
level starts from there, the train keeping its load. The run is won at
the last station. A crash ends it (D6.10).

As built: `src/gen/run.ts` generates the levels one after another, each
starting on the row and at the height of the previous level's end station
(the generator's `startY`, and `startZ`, which shifts its height map),
and lays them side by side overlapping by the station and one column
either side, keeping the earlier level's cells there; each level is
checked again as laid and made again with another seed if it fails. The
world keeps every station (`World.stations`) and the level being played
(`World.seg`); start and end are that level's two stations, the line runs
east from the start station, and the level timer counts the resources
between them (`Game.nextSegment`). No new pile of track is given after
the first level. A run is capped at 110 000 cells (levels x width x
length): making 12 levels of 30 x 300 takes about 1.8 s, during which the
server holds every room; 12 levels of 10 x 70 take about 0.15 s. A server
tick takes under 0.06 ms at either size; joining sends the world as made
plus the cells changed since (53 kB for 12 levels of 10 x 70, 721 kB at
the cap). Not measured: how long the page takes to build the terrain for
a whole run.

**D6.7 Decided, to be tuned by play.** At a station. The train stops at
the destination station, and the start of the next level comes into view.
A countdown starts (30 s, parameter). Upgrade options stand on the
platform, each shown as an object floating above the ground with a clear
shadow on the ground below it. A player picks an option by standing in
its shadow: a pie indicator fills over a dwell time (parameter, proposed
2 s), and when it is full the option is bought. Options can be bought as
long as there is money. Options:

- add a wagon;
- upgrade a wagon or the locomotive;
- upgrade player abilities (carry limit, maybe speed; to be decided);
- end the countdown early (free).

When the countdown ends, the next level starts.

Changed 2026-11-16: no money. Each station offers three upgrades drawn
at random; the team picks one. If none is picked before the countdown
ends, it is lost. The pool: player carry limit (+1, at most 3 times),
train storage (+1 wood and +1 ore, at most 3), player speed (at most 3),
track the crafting wagon holds (+1, at most 3), faster track making (at
most 3). Later: more wagons, a dynamite wagon.

As built: `config/upgrades.json` lists the upgrades (label, most times,
the settings each adds to: carryMax +1, storageMax +1, walkSpeed +0.5,
trackMax +1, craftSecondsPerPair -0.25) and how many a station offers
(3). On arriving at a station other than the last, the sim draws that
many different upgrades not yet taken their most and puts each in a
circle on free ground at the station's height, south of the station
(north if short), spread along it at least two cells apart. A living
player standing in a circle fills its pie over `station.dwellSeconds`
(stepping out empties it); full, the upgrade is taken: the room's
settings change, every player in the room is sent the new values (so
prediction matches, D7.4), the other offers go, and the next level
starts 2 s later instead of at the end of the countdown. The page draws
each offer as a circle with a floating block in the upgrade's colour and
a label such as "Carry 5 → 6" (changed 2026-11-18, below). A new run starts without the upgrades.

Wagons (2026-11-16): two more upgrades, a storage wagon and a crafting
wagon (each at most twice a run). A won wagon is put down where its
offer stood, drawn whole. A player picks it up with empty hands (one at
a time; wagons do not stack), carries it, and presses action beside the
last car: it joins the train at the back, up to 7 cars (else a
refusal). Each storage wagon holds `storageMax` more of each resource;
each crafting wagon holds `trackMax` more track and makes a pair at the
same time as the others. The train's cars are a list each game keeps
(`Train.cars`); the line of a level now takes in up to 10 cells of the
previous level's track behind the start station, so a train longer than
the station stands on track. The page draws the cars from the list,
spreading the load over the wagons of each kind.

Changed 2026-11-18:

- The next level starts as soon as an upgrade is picked, or when the
  countdown ends with none picked, with no wait and no start pad (D6.9).
- A won wagon joins the back of the train at once, and the train's
  level speed rises by `train.speedPerWagon` (placeholder 0.01 cells/s,
  on 0.05) for each car beyond the starting three. Wagons are offered
  only while the train has fewer than 7 cars. A wagon taken with no
  room for it (only by a dev shortcut) still lies on the ground to be
  carried, as above.
- Every upgrade taken shows, and how many times by how much there is of
  it (`src/client/gear.ts`, from the counts taken, `State.taken`):
  - carry: a porter's pack on every character's back, rising behind
    the head, one bundle per time;
  - walk speed: wings at every character's heels, one feather per time;
  - wagon storage: raised side boards on the storage wagons, one per
    time;
  - track on wagon: steel stakes along the crafting wagons' sides, one
    pair more per time (2, 3, 4 per side);
  - track making: a chimney on the crafting wagons, one gold band per
    time;
  - cheaper dynamite: the cost on the dynamite wagon (D6.12) drops and
    its digits turn gold;
  - chop and mine (`tools` in `config/upgrades.json`: `rules.hitSeconds`
    -0.1 a time, at most 3, so 0.5 s a hit becomes 0.4, 0.3, 0.2;
    chopping and mining share the setting): every pickaxe and axe gets a
    gold head and one gold band round the handle per time.
- Offers are pictures only, no words, about two cells across, floating
  over their circles: the pack (carry) and the wing fans (walk speed)
  with one bundle or feather more than now; a pickaxe and an axe
  crossed, with one handle band more (chop and mine); a wagon as it
  would join;
  for a wagon upgrade, the wagon it changes with the added parts glowing
  gold (boards, stakes, chimney bands, or the lowered cost). Walk speed
  has no wagon, so it shows its own look, as carry does.

**D6.8 Closed** (2026-11-16). No money (D6.7).

**D6.9 Decided.** Starting. (Changed 2026-11-18: only a run's first
level waits for the start pad; later levels start the countdown as soon
as the station's upgrade is picked or lost, D6.7.) A level starts with
the train standing in the start station and a start pad beside it: a shadow circle on the
ground with a picture of the choice floating above (since 2026-11-18,
START in gold block letters about 1.5 cells wide, facing south, with
no words drawn as a label),
as for the station options (D6.7). Players standing in the circle fill
its pie over the dwell time; when it is full, a countdown starts (20 s,
`train.startDelay`), and when the countdown ends the train sets off.
Five track pieces (`rules.startTrack`) lie in a pile on the ground
beside the front of the train, on the start pad's side, for players to
pick up and lay. The game clock runs whether or not anyone is connected; the world
does not depend on who is playing.

**D6.10 Decided** (2026-11-16: a crash ends the game). After a crash
(derailment, or the level timer running out) the derailed train lies
tipped over and a large message counts down `train.crashSeconds`
(placeholder 10 s); then the game is over and everyone goes back to the
lobby, told why. The same happens after the station countdown at the
last station. A room closes when its run ends, except the server's first
room, which starts a new run. After arriving at any other station, the
station countdown applies and the next level follows.

**D6.11 Decided.** A settings panel (top right of the page, a
development tool) lists every number and switch in `config/game.json`
with its description, and changes them while the game runs. Rules, train,
character and station settings change for everyone in the room at once
(each room has its own copy, D7.6); level generator settings take effect
from the room's next level; view settings change only that page. Changes
last until the room closes and are not written back to the file. A button starts a new run. The view switch
`showColliders` draws what the game collides with: character cylinders,
the train's circles, the start pad, and the cells blocking one's own
character.

**D6.12 Decided** (2026-11-16). Dynamite. A dynamite wagon (a station
upgrade, D6.7, at most one a run) makes sticks: players put wood and ore
into it beside it, up to what one stick takes (`rules.dynamiteWood`,
`rules.dynamiteOre`, 4 each; an upgrade offered once the wagon is won
lowers both by 1, at most twice), and it makes a stick in
`rules.dynamiteSeconds` (4 s), holding up to `rules.dynamiteMax` (3).
Empty hands take a stick beside the wagon; a stick is carried alone, and
no tool can be taken out while holding one. A press lights it (beside
the wagon, an unlit stick goes back in instead); the fuse
(`rules.fuseSeconds`, 3 s) burns from then on. With it lit, a press let
go within 0.25 s puts it down at the feet; held longer, it is thrown the
way the character faces, farther the longer the hold (full range
`rules.throwRange`, 6 cells, after `rules.throwHoldSeconds`, 1 s). While
aiming, the page shows the path as dots and the blast's reach where it
will rest. A thrown stick flies in an arc, bounces off the ground and off
the sides of higher cells and trees, and slides to a stop
(`src/sim/dynamite.ts`; the server and the page's aim run the same
steps). When the fuse runs out (in hand too) it blasts: trees and grey
rock within `rules.blastRadius` (1.5 cells) become ground, each leaving
one wood or one ore on its cell as a chop or a mine would (2026-11-16: a
way to clear and gather at once); black rock, track, bridges, stacks and
the train are untouched; players within the radius and within a level and a half up
or down die. A player who dies or leaves holding a lit stick drops it,
still lit. The page shows fire, smoke and stone, and shakes the view.
Both sides of the dynamite wagon show what a stick costs (2026-11-18):
on a dark plate, a wood block and its number, then an ore block and its
number, in block digits; gold once the cost has been lowered.

**D6.5 Deferred.** Choice of next station. Instead of a fixed loop, players
may choose among stations with different difficulty or conditions. To be
tried later, using D6.6.

**D6.6 Deferred.** The choice is made in-world. Past a destination station,
track can leave in two or three directions, each marked with a signpost
showing that station's conditions. Laying track toward one chooses it.
The world map must guarantee every choice still allows the loop back to
the first station, for example stations on rings around the start with
choices that keep moving the same way around.

## 6a. Core rules

The rules the server simulates. Times and counts marked "parameter" are
tuning values with the given default, kept in `config/game.json` (D6a.12).

**D6a.1 Decided.** Terms. *Grey rock* is the unmined block in the world.
Mining a grey rock block yields one *ore*. Chopping a forest block yields
one *wood*. Wood, ore and track are the three things players carry.
"Rock" in older text means grey rock; "steel" means ore.

**D6a.2 Decided.** Losing. The train only moves forward along its track,
and track never forms loops within a level, so a level ends one of two
ways: the train reaches the destination station, or it runs past the end
of its track and derails. A derailment ends the session.

**D6a.3 Decided.** Level timer, a safety net against bugs that wedge the
game state. The limit is the time the train needs to cover the most track
the level's resources can make, `max(T, R) * C` cells at the level's train
speed, plus slack. T and R are the level's forest and grey rock block
counts. Slack is a parameter, 1.5 (the limit is multiplied by it), to be
changed if it does not work in play. Reaching the limit
ends the session as a derailment does.

**D6a.4 Decided.** Train speed. The train accelerates from a stop to its
level speed and then holds that speed for the rest of the level. The
simulation keeps a hook for something to change speed within a level, but
nothing uses it yet. Speed may change between levels; what changes it
(number of wagons, engine upgrades) is to be decided.

**D6a.5 Decided.** Crafting. The train has a storage wagon and a crafting
wagon. Players drop wood and ore into the storage wagon. The crafting
wagon takes one wood and one ore at a time and, after a delay, makes C
track, which waits on the crafting wagon to be picked up. Delay: a
parameter, 1 s per pair. Pairs are processed one after another, so 5 wood
and 5 ore dropped in at once give 5C track after 5 s.

**D6a.6 Decided.** Tools. Every player always has both an axe and a
pickaxe. (Tools as objects to pick up and hand over would add
coordination; deferred until it can be tried with three or more players.)

**D6a.7 Decided.** Carrying. A player carries a stack of items of one
kind: wood, ore or track, never a mix. The stack limit is a parameter, 5;
upgrades may raise it. Carrying shows as in
D11a.3.

**D6a.8 Decided.** Chopping and mining. Extracting one forest or grey
rock block takes 4 hits. A hit takes 0.5 s (parameter). The hit
animation plays on every hit. The block shows its progress (D4.16), and
the 4 stages match the 4 modelled stages.

**D6a.9 Decided.** Laying track. A player can place track on any cell
where track is allowed (D4.2, D4.12, D4.14), not only at the end of the
line. Pieces join up with track in neighbouring cells by themselves, and
each piece's shape (straight or curve) follows from the pieces it joins.
Placing a piece can change a neighbour's shape: with t0 placed, t1 placed
north of t0 and then t2 east of t1, t1 changes from straight to a curve
joining t0 and t2.

**D6a.10 Decided.** Tie-break when a piece could join more than two
neighbours. An existing joint is kept, so placing track never breaks a
working line. A new piece joins, in order of preference: the open end
of the line the train is on, then a straight over a curve, then
neighbours in the order north, east, south, west.

**D6a.11 Decided.** Picking up track. Any track the train has not yet
reached can be picked up again, even when it is joined to the line.
Track under or behind the train is fixed. Picking up a piece in the
middle of the line cuts the line there, and the train derails at the
cut if it is not mended in time.

**D6a.13 Decided.** Train make-up. A level starts with the locomotive,
then the storage wagon, then the crafting wagon (where finished track
appears). The train gets longer only by buying wagons at stations (D6.7).

**D6a.14 Decided.** Stacks on the ground. A cell holds one stack of one
kind (wood, ore or track) with no size limit, and every item in it is
drawn, however tall the stack grows. Taking from a stack takes
as much as the player can carry, up to their carry limit. A player who
carries some of a kind and walks over a stack of the same kind picks up
from it automatically, up to the limit.

**D6a.15 Decided.** The action button acts on the cell the character
faces (the direction it last moved):

- empty hands: on a stack, take from it; on a forest or grey rock block,
  hit it; on the crafting wagon, take track;
- carrying wood or ore: on the storage wagon, put it all in; on an empty
  cell or a stack of the same kind, put it all down; on a stack of another
  kind, swap;
- carrying track: on a cell where track is allowed, lay one piece;
  otherwise as for wood and ore.

**D6a.16 Decided.** Collisions are soft and forgiving. A character is a
vertical capsule (radius a parameter). Characters walk on and across
track, which counts as ground. The train pushes a character in its way
gently to the side. A character pressed between the train and something
it cannot move into dies and respawns near the train (D6a.31).
Characters push each other softly too (proposed). The train blocks at
any height: a character above it, on a ledge or boosting off one,
cannot drop into it or cross it, also where it climbs a ramp.

**D6a.17 Proposed** (as built in the first playable version). Details
the rules above left open:

- Each car is 2 cells long, so the starting train is 6 cells and stations
  are 6 cells long (`levelgen.stationLength`).
- A character may also hit a block while carrying what that block yields;
  the yield goes into its hands if it fits, otherwise onto the cell.
- Carrying wood and facing water or a lower cell builds a bridge there at
  the character's level (D4.8). Carrying ore and facing a cell whose far
  side is a face one level up builds a ramp rising in the facing
  direction (D4.7).
- Empty-handed or carrying track, the action button picks up a track
  piece the train has not reached (D6a.11).
- Forest and grey rock blocks stand on their cell's level and block
  walking until extracted; the cell then becomes ground. Walking on top of
  grey rock (D4.16) and stacked blocks (D4.15) are not in yet.

**D6a.18 Decided** (revises D6a.15 and D6a.16).

- Picking up and putting down act on the cell the character stands on:
  taking from or adding to a stack, dropping, laying track, and lifting
  a track piece the train has not reached. Chopping, mining, the wagons
  and bridges act on the faced cell.
- Ramps: on the character's own cell against a face one level up ahead
  (the character ends up on the ramp), on the faced cell one level down
  over an edge (rising back toward the character), or on the faced cell
  at the same level against a face one level up beyond it.
- While a character holds track, wood or ore, a see-through ghost shows
  the track piece (in the shape it would take), bridge or ramp a press
  would build. Server and client use the same planner.
- Carrying track and walking onto a laid piece that is not part of the
  train's line picks it up, up to the carry limit.
- Collisions: characters are thinner (radius 0.2); the train's circles
  cover only the car bodies (`train.collideRadius` 0.35); the pushes of
  all touching circles are summed and capped at the push speed; a
  character the train cannot push sideways is pushed along the track
  ahead of it; a character dies only after being pinned for
  `avatar.wedgeSeconds` (1 s).
- Levels include the ramps the cheapest track needs by default
  (`levelgen.pathRamps`); a harder setting may later leave them out.

**D6a.19 Decided** (revises D6a.18).

- The train is solid to walk into: walking never takes a character
  deeper into the train's circles. Only the train's own push moves
  characters against it.
- The train's push tries, in order, straight away from the train, away
  and ahead along the track, and ahead along the track, taking the first
  that is free and does not go deeper into the train. A character pressed
  toward a wall slides out along it. Death still needs `wedgeSeconds`
  pinned.
- Carrying more than one track piece and pressing on a free cell that is
  not next to the train's line puts them all down as a pile. Next to the
  line, one piece is laid.
- Train models: locomotive Kytric v3, storage wagon (wood and ore go in)
  v8, crafting wagon (track comes out) v6, all at 2x.

**D6a.20 Decided** (revises D6a.8 and D6a.14).

- A character holds one of: the pickaxe, the axe, or no tool. Keys 1, 2
  and 3 choose them; [ and ] (gamepad d-pad left and right, or the triggers) step through
  pickaxe, axe, no tool. The tool shows in the name label and the read-out.
- The axe chops trees and the pickaxe mines grey rock; nothing else hits.
  The yield lands on the block's cell, since the hands hold the tool.
- Only with no tool can a character pick up, place, drop, use the wagons,
  or pick up by walking over a stack or loose track.
- Taking out a tool while carrying puts the stack down on the
  character's own cell, or else on a neighbouring cell at the same height
  (sides, then corners) that is free or holds the same kind. With no such
  cell the switch is refused and a red cross shows over the character for
  `avatar.denySeconds` (0.4 s). The cross is a placeholder for a better
  refusal animation.
- The ? key shows and hides the list of this person's key bindings.
- No trees or grey rock grow on the two rows north of a station, where
  its building stands; those rows are plain ground at the station's
  height.

**D6a.21 Decided.** With empty hands (and no tool), pressing at the
storage wagon takes wood or ore back out, up to the carry limit.
Crafting takes a wood and ore pair as soon as both are there, so the
wagon holds only one kind at a time and there is no choice to make.

**D6a.22 Decided.** A player who leaves, on purpose or by losing the
connection, drops what they carry before going: on the nearest cell that
can take the stack (walkable; not track, a ramp or a station; empty or
holding the same kind; stacks have no size limit), searching rings out
to 4 cells, nearer rings first and the player's own height first within
a ring. Only if no cell within 4 can take it does the stack vanish (event
`lost:<id>:<count>`). A dying player drops their stack the same way
(D6a.31), so a dead player holds nothing.

**D6a.23 Decided** (revises D6a.11). Track on the train's line can be
lifted only with empty hands. With track in hand, pressing on a line
piece does not pick it up; the press goes on to the usual build, so
standing on the line lays the next piece ahead. Loose track (not on the
line) can still be picked up with track in hand, by pressing or walking
over it (D6a.18).

**D6a.24 Decided.** Standing on the open end of the train's line with
track in hand, the next piece goes on the faced cell beyond the end (the
four-way facing), if track can go there and a piece there joins the end:
straight on or a turn. The ghost shows it, as for any build (`plan()`
serves both). Facing back along the line, or standing anywhere else on
the line, there is nothing to place. This includes the start station's
end before any track is laid.

**D6a.25 Decided** (revises D6a.21's put-back). Wood or ore dropped on a
cell around a storage wagon (the eight cells around any cell it covers,
diagonals included, or a cell it covers; D6a.29) goes into the nearest
storage wagon, whichever way the character faces. A wagon
holds at most `rules.storageMax` of each resource (6 wood and 6 ore to
start; read live, so upgrades or the Settings panel can raise it). What
does not fit stays in hand; when nothing fits, the load goes down on
the character's own cell as D6a.33 says, and only failing that does
the refusal (red X) show. A player leaving beside a storage wagon unloads into it first
(D6a.22). The load shows on the wagon as cubes, 4 along by 2 across per
layer, a new layer for each 8, so it rises with the count. Taking back
with empty hands is unchanged (facing the wagon).

**D6a.26 Decided.** Train size and how cars sit on the track. The
locomotive and wagons are drawn at `view.trainScale` 1.1 (1.86 and 1.79
cells long, just under the 2 cells each takes on the track); their loads
keep their own size. Each car is rigid and rests on the track at two
wheel points a quarter of the body in from each end (`WHEELBASE` =
`CAR_BODY` / 2, `carPose` in `src/sim/path.ts`): it sits midway between
them, heads from the rear wheel to the front one and tilts by their
difference in height, so on a bend it is anchored at the wheels and cuts
across the inside instead of bending at its centre. The collision
circles lie along that straight body (`trainBody`), so pushes match what
is drawn. Track sleepers are one voxel tall with the rails one voxel on
top of them, so the steel sits on the wood, and the train rides on the
rail tops, two voxels up.

**D6a.28 Decided.** Fast-forward. While any living player holds the
fast-forward control (keyboard F, gamepad left bumper, left X in AR),
and from the moment the line reaches the end station, the train runs at
`train.fastForward` times its level speed (20). It reaches that speed and
drops back within about a second. The read-out shows "(fast-forward)".

**D6a.29 Decided.** Wagons are used from any of the eight cells around
them, diagonals included, whichever way the character faces. A press
tries the wagons near the character nearest first and the first that can
act does: the storage wagon takes wood or ore in hand (when full, see
D6a.33) and gives wood or ore to empty hands; the crafting wagon gives
track to empty hands or to hands already holding track. So standing
nearer the crafting wagon takes track rather than resources, and an
empty nearest wagon passes the press on to the other one.

**D6a.30 Decided.** The crafting wagon holds at most `rules.trackMax`
track pieces (5 to start; read live, so upgrades or the Settings panel
can raise it). Crafting takes a wood and ore pair only when its C pieces
fit, so it waits while the wagon is full. A character carrying track
beside the crafting wagon (any of the eight cells around it) takes track
from it as from a ground pile, up to the carry limit, without pressing.

**D6a.31 Decided.** Death. A dying character drops what it carries with
the same best effort as a player leaving (D6a.22): into a storage wagon
beside it if wood or ore fits, else the nearest cell that can take it
within 4 cells; only then is it lost. After `avatar.respawnSeconds` it
comes back at a random free cell near the train: walkable, not track, a
ramp or a station, at the height of the train cell it is near, one to
three cells from a cell the train covers (falling back to the start
station's spots if there is none).

**D6a.32 Decided.** Empty hands, a stack on the character's own cell and
a wagon that could give something (D6a.29): the nearer one wins, the
stack measured to its cell's centre and the wagon to the nearest edge of
the cell it covers. So standing up against a wagon takes from the wagon,
and standing in the middle of one's cell takes the stack. Wagons are
ordered among themselves by the same edge distance.

**D6a.33 Decided** (revises D6a.25's refusal). Wood or ore in hand
beside a full storage wagon: a press puts it down on the character's
own cell when that cell is walkable, not track or a ramp, and empty or
holding the same kind (which it joins). Only when the cell cannot take
it does the refusal (red X) show, the load staying in hand.

**D6a.27 Decided.** A stack (wood, ore or track) on the cell where the
next piece of the train's line goes, holding track: with one piece in
hand, a press lays it there, extending the line, and the stack comes
into the hands, if the hands can hold all of it. With more pieces, or a
stack too big to hold, a press swaps hands and stack; a pile of track
meets track in hand as any stack does (on one's own cell they merge).
This holds both for the cell one stands on beside the line's end and for
the faced cell beyond the end (D6a.24). The ghost shows the piece when
one would be laid. On a ramp the ghost is the sloped track piece,
turned with the ramp.

**D6a.12 Decided.** Every tuning value lives in one JSON file,
`config/game.json`, for viewing and changing without touching code. Each
section has a `_doc` object describing its keys. The level generator's
defaults come from the same file.

## 7. Multiplayer

**D7.1 Decided.** Multiplayer goes through a central server. No
peer-to-peer.

**D7.2 Decided.** The server is authoritative. It runs the simulation at a
fixed tick (about 20 Hz to start) and owns the train, resources, inventory,
and track placement.

**D7.3 Decided.** Transport is WebSockets.

**D7.4 Decided.** Clients predict their own avatar movement and reconcile
with server state. Other players' avatars are interpolated.

As built (`src/client/netsync.ts`). The page steps its input at the
server's tick rate (20 a second), numbers each step (`seq`), sends it,
and at once applies it with the server's own player step
(`Game.stepPlayer`): walking and boosting, picking up and dropping,
presses (track, bridges, ramps, wagons), tool changes, and chopping or
mining with their chips. It applies them to a display copy of the
world, which is what the page draws; the server's copy is kept apart.
The server queues each client's steps and applies the oldest each
tick, more (up to 3) while over 2 wait; with none waiting the player
does nothing that tick (`Input.idle`: no move, press or hold, boost and
hit timers paused), so every step is applied exactly once and at the
same pace as on the page. Each state carries, per player, the last step
applied (`ack`) and the timers and press state a replay needs. The page
resets the display copy and its character to the server's and replays
its later steps. Where the server disagrees (a stack someone else took
first, a push by the train or a teammate, the train's load changed by
crafting) the server wins and the page shows its answer: a change of
place fades over about 0.1 s, one over 1.5 cells (a respawn) shows at
once, and everything else switches at once. Chop and mine feedback is
shown once per hit, however often a prediction is redone. Between steps
the character is drawn part way from one step's place to the next.
Other characters and the train are drawn 0.1 s of server time in the
past, between the two states either side, with the drawn time pulled
gently toward that lag so uneven arrival does not show; a jump over 2
cells is not slid through. Death and the respawn place are the
server's alone.

**D7.5 Decided.** After the level is sent, the network carries only state
changes: tile changed, track laid, item picked up or dropped, avatar
positions, train position.

**D7.6 Decided.** Sessions are joined by room code. Target size is 2 to 4
players. Desktop and AR players can share a room.

As built: the server keeps rooms (`server/room.ts`), each with its own
game, players, seed and copy of the shared settings sections, taken from
`config/game.json` when the room is made. Codes are four letters without
I or O. The server starts with one listed room, "Main" (from `--seed`,
12 levels, the file's settings), which a client that names no room
joins. A room other than the first closes after 300 s empty. All rooms
tick, players or not.

The page opens on a lobby (`src/client/lobby.ts`): the player's name
(kept in the browser), the listed rooms (refreshed every 2 s) with
players, level k of N, size and difficulty, a box to join by code, and a
form for a new room: name, listed or by code only, levels (1 to 50,
default 12), width (10 to 30) and length (50 to 300, defaults from the
file) and difficulty. The server takes out of range values to the
nearest limit; if the first level cannot be made it answers with an
error and makes no room. While in a room the address carries
`?room=CODE`, so it can be shared and a reload (or a reconnect) joins
the same room; a Leave button goes back to the lobby.

Difficulty sets (`config/difficulty.json`): named changes to the shared
sections, applied to the room's copy. "moderate" changes nothing; "easy"
(wider gaps, more trees and rock, fewer ponds and black rock, flatter,
looser timer) and "hard" (the reverse, tighter timer) are first guesses.
Each generates at the size limits (10 and 30 wide, 50 and 300 long,
5 seeds each, at most 137 ms a level, checked 2026-11-16).

A room holds one run (D6.4); the level shown is the one being played.

**D7.7 Decided.** Made-up network delay for testing. `--latency MS`
on the server holds every message, both ways, for that many
milliseconds (a round trip takes twice it); `--jitter MS` adds a random
0 to that many more per message. Messages keep their order, as over a
WebSocket. Both are 0 by default (`server/lag.ts`).

## 8. AI companion

**D8.1 Decided.** An external AI can join as a teammate and take simple
commands such as "mine" and "chop".

**D8.2 Decided.** The AI is a separate process that connects to the server
over the same protocol as a human client, flagged as a bot. The server
gives it no special access. It turns directives into movement and actions.

**D8.3 Decided.** Players have an emote menu of icons (wood, stone, water,
and others). Emotes are visible to all connected players and are the
communication channel between players. This is the one exception to D6.1.

**D8.4 Decided.** The AI takes as its directive the most recent emote made
by any player. With no directive, or once the directive is satisfied, it
stays close to the train.

## 9. Levels

**D9.1 Decided.** Levels are JSON files.

**D9.2 Decided.** The full level is sent to each client once, on connect.
Levels are not regenerated from a seed on the client.

**D9.3 Decided.** Levels use Tiled's JSON map format (`.tmj`), so any level
can be opened and edited by hand in Tiled. Format reference: Tiled docs
`json-map-format.rst` and `global-tile-ids.rst` (checked 2026-11-11).

**D9.4 Decided.** Height is stored as one tile layer per height level, each
with a custom integer property `z`. Tile ID `0` is open air.

**D9.5 Decided.** Slices need not be stored. Missing layers above the lowest
stored layer are all open air. Everything below the lowest stored layer is
the material named by the map property `fill_below` (default black rock).

**D9.6 Deferred.** Optional per-layer `fill` property, giving the material
that `0` cells in that layer take instead of open air. Only if a level
needs it.

**D9.7 Decided.** Cell types: open air, ground, tree, water, rock
(mineable), black rock (not mineable), station, plus ramps and track.
How dug-out ground works is deferred.

**D9.8 Decided** (revised 2026-11-12). There is one ramp type, made of
grey rock (D4.7). It is walkable and cannot be removed.

**D9.10 Implemented.** The generator also writes a plain JSON level
(`--json`): row-major arrays of cell type, height and ramp direction, plus
stations, routes and statistics. For readers that do not want Tiled's
layers and flip bits. Tiled stays the format for hand editing.

**D9.9 Decided.** Each ramp shape is one tile. Direction comes from Tiled's
flip bits (diagonal plus horizontal/vertical flips give 90 degree
rotations). Shapes: straight ramp first; outer and inner corner pieces
added later for looks.

## 9a. Level generator

**D9a.1 Decided.** Levels are made by a command-line generator. Output is
the level file. No interactive editor beyond Tiled.

**D9a.2 Decided.** Resource rule: one forest cell plus one grey rock cell make C
track pieces (C is a placeholder). A level must satisfy
min(T, R) * C >= cost of the cheapest start-to-end path, where T and R
count only reachable forest and grey rock cells. Water cells on the path cost
extra trees for bridges.

**D9a.3 Decided.** The cheapest path may not cross black rock.

**D9a.4 Decided.** A resource counts as reachable if an avatar can get to
it from the start station. Trees and rock can be chopped or mined
through. Black rock and (until bridged) water block avatars.

**D9a.5 Decided.** Difficulty comes from K choke points (typically 2):
narrow passes separated by black rock. Bonus: one route is narrow and
light on resources, another is wider but needs more resources.

**D9a.6 Implemented** (`src/gen/generate.ts`). Generation steps:
1. Plot K start-to-end paths as random walks biased toward the end
   station. Path cells are forced: ground, tree or rock only.
2. Place black rock walls across the strip at the choke points, with a
   narrow gap where a forced path crosses.
3. Seed and grow forests, rock, black rock and ponds around random points,
   leaving forced cells alone.
4. Validate: cheapest path by Dijkstra (land 1, water 1 plus bridge trees,
   black rock impassable), reachable resource counts by flood fill, the
   resource inequality, choke point widths. Reject and retry on failure.

**D9a.7 Decided.**
- Water is held in on every side: each water cell's four side neighbours
  are inside the level and at least as high. Water that is not becomes
  ground.
- The ring of cells around each station is plain ground at the
  station's height, and so are the 3 cells east of the start station
  (where the first track goes; the cell after them is level too). A level
  whose cheapest-path ramps would land on these cells is rejected.
- Water is drawn sunk into its top block, its surface at
  `view.waterLevel` (0.75) of the block's height, and its surface bobs
  and shimmers.

Every level is reproducible from its seed.

**D9a.10 Implemented.** Height. Level regions are large rounded blobs
stacked on each other. The surface follows low-octave Perlin noise
(features about `hillScale` = 48 cells across) plus a weak second octave
(`hillNoise`) so outlines are not perfectly round, cut into `levels`
bands. A 3x3 majority filter then removes thin slivers, and any region of
one level smaller than `minBlob` cells (default 60) is merged into its
neighbour. Stations and their surroundings must already sit on one level;
heights are never edited to fit stations or routes. Ponds stay on one
level. Black rock rises one level per `mountainStep` cells in from its
edge, at most `mountainMax` levels. No ramps are generated (D4.7).

**D9a.12 Implemented.** The cheapest track is searched over (cell, track
height) with the building rules: one track piece per cell; bridges over
water or lower ground cost `bridgeTrees` trees per cell; each level change
needs a straight low end / ramp / high end run and costs one grey rock.
The resource rule becomes: trees for track plus bridges, and rock for
track plus ramps, must be covered by reachable trees and rock.

**D9a.14 Implemented.** Ramps included in the level, as options:
`--ramp-chance X` scatters ready-made grey rock ramps on level boundaries
(chance X per eligible cell; a cell is eligible if the cell uphill is solid
and one level up and the cell behind is at its level), and `--path-ramps`
builds the ramps the cheapest track needs (not those standing on bridges,
which are not placed). Both default to off. The search uses ramps already
in the level at no rock cost and prefers them in ties. A track that would
use one column twice (for example a bridge over its own ramp) cannot be
built; the search does not prevent it, so such levels are regenerated.

**D9a.13 Implemented.** Reachable resources: avatars walk on equal
heights, drop one level (boost), and climb one level where a ramp could
be built (the higher cell is ground, grey rock, black rock or tree). Water
blocks; bridges and the rock cost of ramps are ignored here.

**D9a.11 Superseded** by D4.7 and D4.14 (ramps are built by players).

**D9a.7 Implemented.** Route A gets the narrow gaps and a resource-sparse
zone (no trees or rock grown within `sparseRadius` of it unless also near
route B). Route B gets the wide gaps and alternates between the top and
bottom of the strip, so it is longer. The two gaps in one wall are kept at
least two rows of black rock apart.

**D9a.8 Decided.** Levels are generated independently. Composability with
neighbouring levels may be added later as constraints.

**D9a.9 Proposed.** Chaining levels. Consecutive levels share a station:
level n's end station is level n+1's start station. The interface between
two levels is only that boundary: the station row (now `--start-y` /
`--end-y`), and later its height and the strip width. A world generator
would choose the boundary values for the whole loop first, then generate
each level independently with those constraints, so each level is still
validated on its own. Train, track and inventory carried between levels
are game state, not level data.

## 10. Theme

**D10.1 Decided.** Theme is a train. Track is crafted from wood and ore
(D6a.1). A cat-caterpillar theme was considered and dropped: a non-train
theme has to be weird, cute and instantly identifiable all at once, and
none found was. Trains are easy for players to grasp.

**D10.2 Decided.** Resources and the things made from them must be
concrete, everyday, instantly identifiable objects, as wood and ore are.

**D10.3 Decided.** No fuel. The train runs without consumables.

## 11. Assets

**D11.1 Decided.** Art is original or under a libre/free license. Each
asset's license and attribution is recorded in the repository.

**D11.2 Decided.** Asset formats: voxel models as `.vox` (opened and
edited in Goxel), characters as `.glb`. See D13.4.

**D11.4 Proposed.** Goxel (GPL-3) is the libre voxel editor. Per its source
(`src/formats/*.c`, checked 2026-11-11) it imports and exports `.vox`
(MagicaVoxel format), `.gox` (native) and `.txt`, and exports glTF/glb.
A pipeline of Goxel -> glTF -> three.js needs no non-libre tool, and `.vox`
packs can still be opened and edited in Goxel.

**D11.3 Decided.** No offline conversion: the client reads `.vox` and
`.glb` files directly (D13.4). Repeated props
(trees, rocks) are drawn with instancing, and terrain is merged into
per-chunk meshes to keep draw calls low on headsets.

**D11.5 Decided.** Scale: one cell is 32 voxels across; one height level
is 16 voxels (half a cell), so ramps rise at about 27 degrees. The train
and wagons are Kytric's models scaled 2x (a locomotive is 54 voxels long,
about 1.7 cells), on generated track with the gauge scaled to match,
centred in the cell (rails at y = 10-11 and 20-21).

**D11.6 Decided.** Terrain blocks (ground, forest floor, grey rock with
four mining stages, black rock, water, ramps, track on ramps, bridge
decks, stumps, and straight, curved and ramp track) are generated in code
by `tools/genassets.ts`, several variants each, in Kytric's palette.
Locomotives (v1-v3) and wagons (v1-v9: flatcar, gondola, stake car,
coaches and others), each in six colourings and scaled 2x, and trees,
stones, wood and bushes are Kytric's (CC0,
https://kytric.itch.io/voxel-vehicles and
https://kytric.itch.io/voxel-path-and-terrain). A forest cell is a forest
floor block with up to nine Kytric trees; chopping removes trees and
leaves stumps. Grey rock stays block-shaped while mining; cracks
accumulate over four stages.

**D11.7 Noted.** Also CC0 and available if needed: the rubberduck cave
pack (wooden bridge and sloped bridge pieces, cliff walls; Blender meshes;
https://opengameart.org/content/voxel-low-poly-hybrid-cave-pack) and the
FuzzyManStudios medieval pack (props;
https://opengameart.org/content/medieval-theme-voxels-asset-pack).
Licenses checked on those pages 2026-11-12.

**D11.8 Decided.** The station building. A station is three cells in a
row with the track running through them. North of it, centred on its
middle, stands a small shop with a blue awning: model 10 of mehrasaur's
Voxel Buildings (CC0, https://opengameart.org/content/voxel-buildings;
`assets/third_party/mehrasaur/`), its green ground plate left out,
cropped, turned so its front faces the track and scaled 2x to 56 x 56 x
48 voxels (`assets/generated/station-house.vox`): 1.75 cells square and
1.5 cells tall, on the two rows north of the station, which level
generation keeps flat and free of trees and rock. There is no flag. It is
scenery: characters walk through it.

**D11.9 Decided.** Wood and ore are half-cell cubes (generated
`item-wood`, `item-ore`: log with end grain; grey stone with rust and
bright flecks). They keep that size in hands, on the ground and on the
storage wagon: carried stacks are columns, ground stacks fill four
columns per cell. Track in piles and in hands is drawn at 0.7 of a full
piece.

**D11.10 Decided.** Ground look. Each cell picks its tile variant and a
quarter turn of its top by blue noise (avoiding what nearby cells picked,
nearer ones counting more), a broad brightness wash varies the colour
over the level, and grass tufts (some with flowers) are scattered on
plain ground, thicker in patches. Ledges: block sides are drawn darker
than tops, a dark line runs along every exposed top edge, and the sun
casts shadows around the view. Bloom: see D2.8.

**D11.11 Decided.** Visual extras, each switched and tuned in the `view`
section of `config/game.json` and the Settings panel (changing one
rebuilds the terrain):
- `ao`: corner shading. A top's corners darken where higher columns
  (or grey rock) stand beside them, `aoStrength` at most.
- `groundDetail`: ground tops with mottled dirt, loam blotches, pebble
  clusters and thin cracks.
- `groundPatches`: broad light and dark, warm and cool colour patches
  across ground, forest, rock and station tops, greener near forests.
  Colour is set per corner, so patches have no cell seams.
- `groundDecor`: fallen leaves in and near forests, gravel near grey
  rock, pebbles, and flower patches away from forests.
- `treeVariety`: about `treeFill` of a forest cell's nine spots hold a
  tree, each with its own size, turn and colour; some empty spots hold
  a bush. `treeSway`: trees and bushes sway (shadows stay still).
- `rockBoulders`: grey rock as a pile of boulders (built at half
  resolution and drawn at 2x) reaching `boulderSpill` past the cell.
  Hits remove the small ones first and shrink the rest. Collision is
  still per cell.
- `crags`: spires on black rock tops, taller inside mountains.
  `blackStrata`: black rock sides banded in layers.

**D11.12 Decided** (default look; the D11.11 continuous extras are off
by default).
- `designedTiles`: tile faces are pixel art drawn to a plan
  (`src/client/tiles.ts`). Each material has a small palette, eight
  variants (mostly plain, one rare special) and, on tops, a lit rim on
  each side where the ground drops away (16 edge versions), so ledges
  read and cells stay distinct. Tops are not turned.
  - Ground: dirt with specks, pebbles, a crack, sprigs; special: a flower.
  - Forest: staggered leaf marks; sides carry a grass lip hanging in a
    saw-tooth fringe. Specials: a flower, a mushroom.
  - Black rock: dark faceted stone on top, layered ledges on the sides.
    Special: moss.
  - Grey rock: light faceted stone; each mining stage adds a crack.
- `faceDecor`: small pieces on exposed sides: vines on black rock walls,
  grass hanging over forest ledges, stones in dirt sides.
- `edgeLines`: the dark line along exposed top edges.
- `assets/preview/designed-tiles-mock.png`: a flat three-quarter mock-up of
  the tiles from a hand-made map (not the game's renderer).

**D11.13 Decided** (default with `designedTiles`).
- `carvedBlack`: black rock is carved like old ruins. The carving is
  etqws3's CC0 block sheet (`assets/third_party/etqws3/`): its orange
  scheme has five colours, read as classes (hole, groove, base, lit edge,
  highlight; `src/assets/carved.ts`) and recoloured with a black rock
  palette, drawn at 2x. Eight blocks are tops (the last, a carved face,
  is a rare special); halves of two others are sides. The blocks carry
  their own lit and dark edges, so carved tops get no rim.
- `carvedRelief`: the carving is real height. `tools/carvevox.ts` reduces
  each top's class map (`--factor 2` keeps the sheet's 16 x 16 pixels as
  2 x 2-voxel columns; `--factor 4` merges 2 x 2 pixels by majority, ties
  to the lower class, into 4 x 4-voxel columns) and raises each column by
  class (`--heights`, voxels for hole, groove, base, lit edge, highlight;
  default 0,1,2,3,4). It writes `carved-relief-*.vox`, which the game
  stands on the textured top; class-0 columns leave the top showing.
  The highest columns are 1/8 cell; the walking height is unchanged.
- The sun shines from the north-west, where the painted light comes from.

**D11.14 Decided** (default with `designedTiles`).
- `brickRock`: grey rock is stone blocks from SpiderDave's CC0 Techno
  Bricks sheet (`assets/third_party/spiderdave/`). One grey unit is used
  (`BRICK_UNIT` in `src/assets/bricks.ts`, row 2 column 15: blocks of
  mixed sizes); its 16 x 16 body tile has three colours, read as joint,
  stone face and lit edge, recoloured with a soft, low-contrast grey
  palette and drawn at 1x (`BRICK_PX`), so the tile repeats 2 x 2 on a
  top. Variants shift the tile cyclically; each mining stage adds a
  crack. One class map per stage and variant (`brickClasses`) feeds both
  the texture and the relief. Sides are its upper or lower half. No rim:
  the tile has its own lit and dark edges.
- `brickRelief`: each grey rock cell is one carved voxel block, 32 x 32
  x 16 (`brickBlock` in `src/assets/bricks.ts`), from eight similar
  units (`BRICK_UNITS`: mixed-size stone blocks, picked from the 50 units
  that use exactly the three greys). The top and every exposed side cut
  their class map into a solid block: a column of class k stays solid to
  depth D - heights[k] below its face (D the deepest height), so joints
  and cracks are cut in and stones stand at the face. Edges and corners
  are cut by every face they belong to, and on exposed edges short runs
  of the outermost voxels are worn away; unexposed sides stay flat. No
  frame between neighbouring cells: the stone runs on, and cells read
  apart by their tints. The block is as tall as the rock, so the walking height is the
  rock's top.
- `tools/brickvox.ts` sets the carving (`--heights` per class, joint,
  stone face, lit edge, crack, default 1,3,3,1; `--border` 0, a joint
  ring around each cell if set; `--chip`
  0.35) in `rock-relief.json` and draws the preview. With 2048 blocks (8
  units x 4 stages x 4 variants x 16 sets of exposed sides) the game
  carves the ones a level needs with the same function instead of
  loading files; `--vox DIR` writes sample blocks for viewing elsewhere.
- In the game, carving costs about 10 ms a block (Node), so the terrain
  carves at most 6 ms' worth per frame (`carveMs`); a cell not carved
  yet draws as the textured box. Blocks are kept for the session. A
  chunk's blocks are merged into one mesh (nearly every block differs, so
  instancing would not help). About 2400 triangles per cell (323 rock
  cells: 0.77M).
- `rockPatterns` (default 8) and `rockPatternScale` (default 3): a cell's
  unit is the same over regions about that many cells across, with
  ragged edges, so a patch shares a pattern and neighbouring patches
  differ; scale 0 picks per cell.
- Mining: the stage follows the hits (`hitsPerBlock` 4 shows stages 0 to
  3). Stage s has 2s dark cracks two pixels thick, on the top and each
  side; a stage keeps the cracks before it.
- `assets/preview/rock-relief.png`: a small rock patch from the tool's
  own voxel render.

**D11.15 Decided** (default on).
- `groundTints`: each ground cell's column is multiplied by one of 16
  mild colour tints (`GROUND_TINTS` in `src/client/terrain.ts`, each
  channel within 8% of neutral: lighter, darker, warmer, cooler, drier,
  redder, greyer), picked at random per cell. `groundTintCount` uses the
  first N (default 12); `groundTintStrength` scales them (default 1).
  Variation stays per cell, so the grid still reads, and it survives
  zooming out where the tile detail averages away.
- `treeTints`: each tree (not each cell) is tinted from `TREE_TINTS`,
  16 mild shifts of the greens (yellower, bluer, darker, lighter, olive;
  each channel within 10%), through its instance colour. With
  `treeVariety` the tint multiplies that colour.
- `blackTints`: each black rock column is tinted from `BLACK_TINTS`, 16
  mild shifts of the dark greys (within 8%), and its carved relief block
  gets the same tint so the two match.
- `rockTints`: each grey rock cell is tinted from `ROCK_TINTS`, 16 mild
  shifts of the light greys (within 7%); box and relief alike.
- Each has its own `...TintCount` and `...TintStrength`.
- `assets/preview/ground-tints.png`: flat ground tops without and with
  the tints (no lighting, ao or the smooth noise tint).

**D11.17 Decided.** Water variety (`view.waterVariety`), all in the
water material, subtle: a slow swell whose strength wanders over the
level, so some stretches heave a little more than others; each cell a
slightly different shade (up to about 3% per channel); and every five to
ten seconds per cell a faint ring spreading from a random point in it
for about a second. The water's waves use level units, so they look the
same on the page and on the AR board.

**D11.18 Decided.** Derailment. When the train comes off the end of its
track, the view shakes for about 0.7 s (on the page the camera moves; in
AR the level moves on the board, since the viewer's head is theirs) and
the front of the train explodes (`src/client/blast.ts`), in voxels:
solid cubes square to the level's axes, their places and sizes snapped
to a 1/16-cell grid. About sixty fire cubes swell, rise and cool from
white-yellow through orange to dark red within about a second (bright
enough for the bloom filter at first), then shrink away; grey smoke
cubes rise and spread and are gone within about three seconds; twelve
tumbling chunks of red, yellow and grey junk are thrown out on arcs,
each streaming a trail of small cubes of its colour (red and yellow
trails glow) until it lands; and thirty bits of dark metal debris and
embers fly out as mining chips do. The train then lies tipped over as
before.

**D11.16 Decided.** Mining feedback: each hit on grey rock throws about
ten stone chips (small cubes in the rock's colours and tint) that fly up,
bounce once on the ground and fade; breaking the block throws a bigger
burst with dust. The client spots hits from cell updates (hits up) and
breaks (grey rock becomes something else); `src/client/chips.ts`.
Chopping a tree throws flat flakes of bark (the tree models' brown, with
the tree's tint) and pale fresh-cut wood that fly and bounce like stone
chips, and a few leaves (the models' greens) that drift down slowly,
slowed by drag; felling the last tree of a cell throws a burst two and a
half times bigger.

## 11a. Characters

**D11a.1 Decided.** Player characters are not human. A character fills
most of its cell. (Generated voxel pigeons were tried and dropped.)

**D11a.2 Decided.** Characters are Kenney's Mini Characters (CC0): knight,
zombie and robot, used unmodified as `.glb` files in
`assets/third_party/kenney/` with their shared texture. They are rigged
meshes, not voxels, and come with animations the game can use directly
(`idle`, `walk`, `sprint`, `jump`, `fall`, `die`, `pick-up`,
`holding-both`, `interact-right`, `emote-yes`, `emote-no` and others).
One glTF unit is one cell: about 0.77 cells wide and 0.7-0.85 cells tall.

**D11a.3 Decided.** A character carrying wood or rock plays the
`holding-both` animation, with a stack of Kytric logs (wood) or stones
(rock) in its hands.

**D11a.5 Decided.** A character holding a tool shows it in its right
hand: a pickaxe or an axe built from a few boxes, held on the right arm
bone so it swings with the arm when the character hits. It is drawn
large enough to read from the high camera: `view.toolScale` 1.8 makes it
0.4 cells long, about half a character's height. The handle
points forward out of the fist, tilted up; the axe blade is on the
downward side of the head.

**D11a.4 Open.** How players are told apart (several players may pick the
same character), and which character the AI teammate uses. To be
worked out later.

## 12. Repository

**D12.1 Decided.** All project artifacts are under git.

**D12.2 Decided.** Project files are CC0 1.0. Source files and documents
carry an SPDX header; generated level files carry a `license` property.
Third-party assets keep their own licenses.

## 13. Packaging and running

**D13.1 Decided.** No bundler and no dev server. The game server runs with
one command, `node server/main.ts` (Node 24 runs TypeScript directly).
It serves the WebSocket and, by default, the client files too, so one
command runs everything. Any ordinary static web server can serve the
client files instead.

**D13.2 Decided.** Client files are made by `node tools/build.ts`, which
has no dependencies: it removes the TypeScript type annotations with
Node's built-in `stripTypeScriptTypes` (marked experimental in Node 24),
renames `.ts` imports to `.js`, and copies the page, the libraries, the
assets and `config/` into `web/`. `web/` is build output and not kept
in git.

**D13.3 Decided.** Fully standalone: no CDN, no web fonts (system fonts
only), no outside connections at run time. Libraries are downloaded once,
pinned to an exact version and committed under `vendor/` with their
licenses and checksums: three.js 0.186.1 (MIT, only the files used) and
ws 8.22.0 (MIT, the server's WebSocket library). The page maps `three`
to the local copy with an import map. `npm install` is needed only for
the type checker and the tests' type definitions, not to run the game.

**D13.4 Decided.** Runtime asset loading. The client reads `.vox` files
itself and merges terrain into one mesh per chunk; repeated props are
drawn with instancing. Characters load as `.glb` through three.js's
GLTF loader.

## 14. Status

**D14.1** (2026-11-12) First playable version, desktop browser only:

- the rules simulation (`src/sim/`) with tests;
- the server (`server/main.ts`): generates a level, runs the game at the
  configured tick, sends state to clients; after a level ends it waits
  the station countdown and starts the next level, which again begins
  with the start pad (a stand-in until stations, D6.7, are built);
- the client (`src/client/`, `client/index.html`): terrain, trees, rocks,
  track, stacks, train, Kenney characters with animations, carried
  stacks, keyboard, gamepad and AR controller input, emote menu, follow
  camera with orbit, window clipping, a development read-out of the game
  state, AR mode on a table (D3.9).

Not in yet: station upgrades and money (D6.7, D6.8),
silhouettes and the peephole (D5), the free camera (D2.4), the
silhouette on off-screen markers (D2.5), the AI teammate (D8), sound.
