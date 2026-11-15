# Rules summary (as implemented in the engine)

Numbers live in `packages/engine/src/config.ts` and `board.ts`; items marked *(assumed)* are draft
values to confirm in playtesting. This describes **rules version 2** (`RULES_VERSION`).

## Goal
Beat the wizard, then open his chest with the 3 correct keys out of 7. First to do it wins.
If everyone else leaves the game (3 missed turns in a row), the last player wins.

## Setup (randomized from the game seed)
- Combination: 3 of keys 1–7.
- 10 rooms: 5 monsters, 4 treasure, 1 trap *(assumed)*; no room is empty. The 7 keys are hidden
  in 7 of the 9 monster/treasure rooms (a monster guards it, or it lies with the treasure).
- Every treasure room also holds one item, drawn from the treasure deck: Provisions ×2, Potion of
  Skill, Potion of Luck, Enchanted Sword, Shield, Amulet of Return, Scroll of Seeing (8 items, 4
  drawn).
- Maze: 16 tiles (2 cross, 5 T, 3 straight, 4 corner, 2 dead end) dealt into a 4×4 grid; the deal
  is checked to be crossable.

## Characters
Starting stats (defaults; per-game overrides via `config.archetypes`):

| Archetype | Skill | Stamina | Luck |
|---|---|---|---|
| Warrior | 10 | 14 | 1 |
| Survivor | 8 | 20 | 2 |
| Lucky | 8 | 14 | 4 |

## A turn
Before rolling you may **use items** (free, any number). Then, instead of rolling you may
**rest** (+4 Stamina *(assumed)*), **attack** a player on your square, or (in the maze)
**re-turn** a tile.

1. **Roll** 1d6 (server-side).
2. **Move** up to that many squares. Entering a new location ends the move.
3. **Resolve** what's there: a room's encounter (first visit), the wizard (lair), dropped keys,
   and optionally attack a player on the square you moved to.

## Items
Items you hold are public, like keys. They are not dropped when you are defeated.

| Item | Effect |
|---|---|
| Potion of Skill | Drunk when found: +1 Skill. |
| Potion of Luck | Drunk when found: +2 Luck. |
| Provisions | Carried. Eat before rolling (free): +4 Stamina. |
| Scroll of Seeing | Carried. Read before rolling (free) on an unrevealed room: you alone see what is in it, including a monster's key. |
| Enchanted Sword | +1 Skill against monsters and the wizard (not players). |
| Shield | Each lost combat round costs 1 less Stamina (minimum 1), in every fight. |
| Amulet of Return | The next time you are defeated holding keys, you keep them; the amulet crumbles. |

## Camp
A camp sits between R4 and R6/R7 (R4 → camp → R6 or R7). It has no encounter; entering it ends
your move like any location. Once you have entered it, defeats wake you at the camp instead of
the Entrance.

## Combat
One action resolves the whole fight. Each round both sides roll 2d6 + Skill; the lower loses
2 Stamina (less a shield's block). You flee automatically once below your flee threshold (default 4). With auto-luck on,
a Luck token rerolls a round you were losing. Fleeing a monster puts you back one square.

## Player vs player
Winner takes 1 key (attacker chooses which; a winning defender takes one at random). The loser
is protected from attacks until their next turn. Keys held are public.

## Defeat (0 Stamina)
Drop all keys where you fell (unless your Amulet of Return saves them), wake at the Entrance — or
the camp, once you have reached it — with half Stamina, and miss your next turn.

## Maze
- Enter from the maze square into row 1, column 0 (west side); exit from any column-3 tile that
  opens east, into the lair.
- Stepping onto a face-down tile ends your move. You **see the tile, then choose its rotation**;
  it must open toward the side you came from.
- Your tiles and rotations are private; others only see that you're in the maze.
- **Re-turn a tile** instead of rolling: the tile you're on or a revealed tile next to it (from
  the maze square: the entry tile). *Added in M1: without it, a badly turned tile could strand a
  player.*

## Wizard and chest
- Entering the lair starts a duel with the wizard (Skill 10, Stamina 14 *(tuned in M1)*), at full
  Stamina every time. Flee: back to the maze square. Lose: normal defeat.
- While in the lair you can't roll: guess the chest, rest, or leave (back to the maze square,
  wizard must be beaten again).
- Guess: choose 3 keys you hold. Right: you win. Wrong: everyone sees the keys and how many were
  correct; you lose 3 Stamina.

## Timer
The server times out a turn after its deadline (12/24/48h). A player who flipped a maze tile and
timed out gets it turned automatically. 3 missed turns in a row removes the player and drops
their keys.
