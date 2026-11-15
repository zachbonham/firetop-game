# Firetop Mountain (working title)

An asynchronous, 2–4 player web board game inspired by *The Warlock of Firetop Mountain* board game.
Players explore a fixed board of 13 locations, fight monsters and each other for 7 numbered keys,
cross a private tile maze, beat the wizard, and open his chest with the right 3 keys.

- Full rules and plan: [docs/rules.md](docs/rules.md) (summary) and the planning doc it links to.
- Milestones: [docs/milestones.md](docs/milestones.md)

## Layout

```
packages/
  engine/        M1: pure TypeScript rules engine (no I/O)
    src/         state, actions, reducer, board, maze, combat, player views, scripted bot
    test/        vitest unit tests + simulated games
    sim/         balance simulator
  client/        M2: local hot-seat test board (Vite + React, placeholder SVG board)
```

M3 adds `packages/server` (Fastify + SQLite).

## Getting started

Requires Node 20+.

```bash
npm install
npm test            # unit tests + simulated games
npm run typecheck
npm run build       # compiles packages/engine to dist/
npm run sim -- 200  # balance simulation, 200 games per setup
npm run sim -- 200 --config firetop-config.json  # ...with rule overrides
npm run dev         # local test board at http://localhost:5173
npm run replay -- playtests/autosave/<file>.json  # print a saved game in full
```

## Board art and phone layout (M5)

- **Art:** the board, maze tiles, tokens, icons and encounter cards are original generated SVG.
  To add hand-made portraits, monster art or location art, drop an image into
  `packages/client/src/assets/art/<portraits|monsters|locations>/<slug>.webp` and it replaces the
  generated stand-in. [docs/art.md](docs/art.md) lists every slot, its slug and a suggested size.
- **Cards:** revealing a room, fighting, dueling, reading a scroll, guessing the chest or winning
  pops up a card. Cards are built from the player's own views, so they never leak secrets, and
  the online client can reuse them. Click a known room on the board to see its card. The
  *Cards* toggle turns the pop-ups off.
- **Phones:** under 820px wide, the side panel stacks below the board and the board becomes a
  zoomed, horizontally scrollable view that follows the current player (*Whole board* /
  *Zoom in* switches between them). The tools fold into a ☰ menu, and buttons are larger on
  touch screens.

## Local test board (M2)

Everything runs in the browser against the engine; nothing is sent anywhere.

- **Setup**: 2–4 seats, each a hot-seat human or a bot; a seed; and every `GameConfig` number
  (archetype stats, wizard, room mix, damage, healing...). *Export for sim* writes only the
  values you changed, ready for `npm run sim -- --config`.
- **Play**: click highlighted squares/tiles to move; the side panel offers roll, rest, attack,
  re-turn tile, chest guesses and the flee/auto-luck settings. *Pass screen* hides the board
  between human turns. *Let the bot choose* plays one step for a human seat.
- **Tuning tools**: bot speed (paused / step / ... / instant), *God view* (combination, hidden
  rooms and loot, the maze deal, everyone's real position), *Undo* / *Undo to human*
  (replays the action log, so dice don't change), *Timeout* (simulates the server's turn
  timer), live stats, and *Save* / *Load* (seed + config + action log as JSON).
- **Autosave**: while `npm run dev` is running, every game is written after each action to
  `playtests/autosave/<start time>-seed<seed>.json` (gitignored; copy a game into `playtests/` to
  keep or share it). Saves record the rules version and git commit; a save from other rules
  won't load (check out its commit to replay it). A browser game that no longer loads is copied
  to `playtests/autosave/unloadable-*.json` rather than lost.
- **Reviewing a game**: `npm run replay -- <file>` prints the combination, every room, final
  players, stats and the full log including private entries (`--all` adds the action list).

## Engine in one minute

```ts
import { createGame, applyAction, playerView } from "@firetop/engine";

let state = createGame({
  seed: 12345,
  players: [
    { id: "a", name: "Ann", archetype: "warrior" },
    { id: "b", name: "Bo", archetype: "lucky" },
  ],
});

const r = applyAction(state, "a", { type: "roll" });
if (r.ok) state = r.state;

// Send clients only this, never the full state:
const view = playerView(state, "a"); // includes view.me.moveOptions
```

- `applyAction(state, actor, action)` is pure: it never mutates its input, and all dice come
  from the seeded RNG stored in the state, so a game replays exactly from its seed + action log.
- `playerView(state, playerId)` strips secrets: the chest combination, the maze deal, unrevealed
  encounters, monster loot, the RNG state, other players' maze tiles and maze positions, and
  private log entries.
- The server sends `{ type: "timeout" }` as actor `"system"` when a turn's deadline passes.
