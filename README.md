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
    src/         state, actions, reducer, board, maze, combat, player views
    test/        vitest unit tests + simulated games
    sim/         scripted bot + balance simulator
```

Later milestones add `packages/server` (Fastify + SQLite) and `packages/client`.

## Getting started

Requires Node 20+.

```bash
npm install
npm test            # unit tests + simulated games
npm run typecheck
npm run build       # compiles packages/engine to dist/
npm run sim -- 200  # balance simulation, 200 games per setup
```

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
