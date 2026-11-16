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

## Deploy (M6)

One Fly.io machine with a volume for the SQLite file and Litestream backups to a Tigris bucket.
In production the server also serves the client, so `/` is the online lobby and `/local` is the
test board. CI (typecheck, test, build) runs on every push and pull request. Deploys run on
merge to `main` once they're turned on. [docs/deploy.md](docs/deploy.md) has the one-time Fly
setup, the GitHub secrets, and how to restore.

## Online client

Play over the network against the server (M3/M4). For local development, run both:

```bash
npm run server   # API on http://localhost:3000 (data/firetop.db)
npm run dev      # client on http://localhost:5173; Vite proxies /api to the server
```

- **`/online`:** start a game. The first seat is yours (your name and hero); add up to 3 more,
  each an invited person or a bot, and pick the time per turn (1h, 12h, 24h or 3 days). You get
  one invite link per invited person, `/play/<game>#<seat token>`. Anyone with a link takes that
  seat. This device keeps your seat (and the invite links), and the page lists your games.
- **Waiting room:** until the game starts, an invite link opens a form where its player picks
  their own name and hero (and can change them until the start). The game starts by itself once
  every invited seat is claimed. The creator can press *Start* earlier, with whoever has joined
  (at least 2 players, bots included); seats still open are dropped, and their links then say
  the game went ahead without them.
- **`/play/<game>`:** the game, drawn only from your own player view.
  - Opening an invite link saves its token on the device (localStorage) and removes it from the
    address bar.
  - The page waits on the server for other players' moves (long-poll) and shows whose turn it
    is and when it times out.
  - Your own actions pop up encounter cards.
  - Abandoned, finished and removed-from-the-game states each show a banner.
  - If someone moves first (`409 stale_seq`), you get the fresh board and a note to try again.
- **One seat per game per browser:** a device holds one seat per game. To test two seats on
  one machine, use a second browser profile, or open the other link last and don't reload the
  first tab.
- **Local test board:** still at `/`. The board component draws from a player view alone, or
  from the full state for the god view.

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

## Server (M3, M4)

`packages/server` is a Fastify app over one SQLite file (Node's built-in `node:sqlite`, so no
native build). It stores each game's seed, rule overrides, `RULES_VERSION`, seats and the action
log; the game state is never stored but rebuilt by replaying the log through the engine (cached
in memory). Bot moves are logged like any other action. A game stored under another
`RULES_VERSION` is refused (410), not replayed.

Settings (env): `FIRETOP_DB` (default `data/firetop.db`, gitignored), `PORT` (3000), `HOST`
(127.0.0.1), `PUBLIC_URL` (prefix for invite links; default relative links).

**Seat tokens.** Creating a game returns one invite link per human seat (the creator's first):
`/play/<gameId>#<token>`. The token (32 random bytes, base64url) is in the URL fragment so it
never reaches server logs; the server keeps only its sha256. Clients send it as
`Authorization: Bearer <token>`, and the server acts as that token's seat: requests never name
an actor. Anyone with the link plays that seat.

| Request | Auth | Response |
|---------|------|----------|
| `POST /api/games` `{seed?, config?, turnSeconds?, seats: [{name, archetype, bot?} or {open: true}]}` (2-4 seats, at least one human) | none | `201 {gameId, status, rulesVersion, invites: [{playerId, name, open, url}]}` |
| `GET /api/games/:id` | seat token | `{gameId, seq, rev, playerId, host, seats, status, turnSeconds, deadline, view}` |
| `GET /api/games/:id?rev=<rev>&wait=<ms>` | seat token | long-poll: as above, once `rev` moves past the one given or after `wait` (default 25 s, max 30 s). `since=<seq>` works the same on `seq`. |
| `POST /api/games/:id/claim` `{name, archetype}` | seat token | claim your open seat, or change your name or hero, while the game is waiting; same as `GET` |
| `POST /api/games/:id/start` | the creator's seat token | start a waiting game with the seats claimed so far; same as `GET` |
| `POST /api/games/:id/actions` `{action, expectedSeq}` | seat token | same as `GET /api/games/:id` |
| `GET /api/games/:id/log` | none (the game id) | public log: `{gameId, seq, status, turn, turnSeconds, deadline, seats (with status), winner, log}` |
| `GET /api/health` | none | `{ok, rulesVersion}` |

- `seq` is the number of actions in the log; `rev` also counts seats claimed and the start.
  `view` is always `playerView(state, <your seat>)`, or null while the game is waiting. `seats`
  is the public seat list (`playerId, name, archetype, bot, open`): every seat while waiting,
  only the players once started.
- **Open seats.** A `{open: true}` seat is invited: the game is `waiting` (no state, no log, no
  deadline) until every open seat is claimed, or the creator (the first human seat, which can't
  be open) starts it with at least 2 claimed seats. Open seats are then dropped: the players are
  the claimed seats in seat order. Their player ids keep their seat numbers (`p1, p3`), and the
  stored setup replays the same way. A game with no open seats starts at once, as before.
- An action is checked against a JSON schema (any player `Action` except `timeout`, which only
  the server sends), then applied by the engine as the token's seat. After it, bot seats play
  (`botAction(playerView(...))`) until a human is up or the game ends; the human's action and the
  bots' are appended in one transaction.
- `config` overrides are checked against `DEFAULT_CONFIG`'s shape (nested objects in full,
  whole numbers 0-100) and the setup must pass `checkInvariants`.
- Errors are `{error, code}`: `400 bad_request` (schema), `400 bad_config`, `400 rejected`
  (the engine's message, e.g. "not your turn"), `401 unauthorized` (missing or wrong token),
  `404 not_found`, `409 stale_seq` (`expectedSeq` isn't the current `seq`: reload and retry),
  `409 game_over` (the game is finished or abandoned), `409 not_started` (acting in a waiting
  game), `409 started` (claiming or starting a game that has started), `409 too_few` (starting
  with fewer than 2 players), `403 not_host`, `410 rules_version`, `410 seat_dropped` (a link
  whose seat was still open when the game started).

**Turn timer (M4).** `turnSeconds` is one of 3600, 43200, 86400 (default) or 259200 (1h, 12h,
24h, 3 days). It's a server setting, not a rule, so it doesn't affect replays or `RULES_VERSION`.
`deadline` (ISO) restarts only when the turn passes to the next player, not on every action
within a turn or when another player changes their settings. Every minute the server sweeps
for overdue games and applies a `system` `{type: "timeout"}` (logged publicly), then lets bots
play, through the same commit path as a player's action. After downtime, an overdue game gets
one timeout and then a fresh deadline: players aren't punished for the outage.
`status` is `waiting`, `active`, `finished` or `abandoned`. A waiting game has no deadline: the
clock starts with the game. Abandoned means no human players are left
(all removed for missed turns). Bots stop, `deadline` becomes null, actions get `409 game_over`,
and nobody wins, even if the engine's last-player-standing rule names a bot (`view.winner`
then means nothing, and `/log` reports `winner: null`).

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
