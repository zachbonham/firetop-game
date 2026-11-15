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
  server/        M3: game server (Fastify + one SQLite file, invite links, action log)
    src/         app (routes), games (replay cache, bots, auth), db (node:sqlite), schemas
    test/        vitest API tests via fastify.inject
```

## Getting started

Requires Node 22.13+ (the server uses the built-in `node:sqlite`; the engine and client alone run on Node 20).

```bash
npm install
npm test            # unit tests + simulated games
npm run typecheck
npm run build       # compiles packages/engine to dist/ (client: vite build; server: typecheck)
npm run sim -- 200  # balance simulation, 200 games per setup
npm run sim -- 200 --config firetop-config.json  # ...with rule overrides
npm run dev         # local test board at http://localhost:5173
npm run replay -- playtests/autosave/<file>.json  # print a saved game in full
npm run server      # game server at http://127.0.0.1:3000 (data in data/firetop.db)
```

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

## Server (M3)

`packages/server` is a Fastify app over one SQLite file (Node's built-in `node:sqlite`, so no
native build). It stores each game's seed, rule overrides, `RULES_VERSION`, seats and the action
log; the game state is never stored but rebuilt by replaying the log through the engine (cached
in memory). Bot moves are logged like any other action. A game stored under another
`RULES_VERSION` is refused (410), not replayed.

Settings (env): `FIRETOP_DB` (default `data/firetop.db`, gitignored), `PORT` (3000), `HOST`
(127.0.0.1), `PUBLIC_URL` (prefix for invite links; default relative links).

**Seat tokens.** Creating a game returns one invite link per human seat:
`/play/<gameId>#<token>`. The token (32 random bytes, base64url) is in the URL fragment so it
never reaches server logs; the server keeps only its sha256. Clients send it as
`Authorization: Bearer <token>`, and the server acts as that token's seat: requests never name
an actor. Anyone with the link plays that seat.

| Request | Auth | Response |
|---------|------|----------|
| `POST /api/games` `{seed?, config?, seats: [{name, archetype, bot?}]}` (2-4 seats, at least one human) | none | `201 {gameId, rulesVersion, invites: [{playerId, name, url}]}` |
| `GET /api/games/:id` | seat token | `{gameId, seq, playerId, seats, view}` |
| `GET /api/games/:id?since=<seq>&wait=<ms>` | seat token | long-poll: as above, once `seq > since` or after `wait` (default 25 s, max 30 s) |
| `POST /api/games/:id/actions` `{action, expectedSeq}` | seat token | `{gameId, seq, playerId, seats, view}` |
| `GET /api/health` | none | `{ok, rulesVersion}` |

- `seq` is the number of actions in the log. `view` is always `playerView(state, <your seat>)`;
  `seats` is the public seat list (`playerId, name, archetype, bot`).
- An action is checked against a JSON schema (any player `Action` except `timeout`, which only
  the server sends), then applied by the engine as the token's seat. After it, bot seats play
  (`botAction(playerView(...))`) until a human is up or the game ends; the human's action and the
  bots' are appended in one transaction.
- `config` overrides are checked against `DEFAULT_CONFIG`'s shape (nested objects in full,
  whole numbers 0-100) and the setup must pass `checkInvariants`.
- Errors are `{error, code}`: `400 bad_request` (schema), `400 bad_config`, `400 rejected`
  (the engine's message, e.g. "not your turn"), `401 unauthorized` (missing or wrong token),
  `404 not_found`, `409 stale_seq` (`expectedSeq` isn't the current `seq`: reload and retry),
  `410 rules_version`.

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
