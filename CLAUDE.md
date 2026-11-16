# CLAUDE.md

Async multiplayer board game (Warlock of Firetop Mountain inspired). See README.md and docs/.

## Conventions
- TypeScript everywhere, npm workspaces (`packages/*`), Node 22.13+ (server needs `node:sqlite`), ESM, strict TS with
  `noUncheckedIndexedAccess`.
- `packages/engine` is pure: no I/O, no Date.now(), no Math.random(). All randomness via the
  seeded `Rng` whose state lives in `GameState.rng`. `applyAction` must never mutate its input.
- Secrets never leave the server: anything sent to a client goes through `playerView()`.
  When adding state, decide whether it is public, private to one player, or secret, and extend
  `playerView` and `test/view.test.ts` accordingly.
- Rule numbers belong in `src/config.ts` (or `board.ts` for the layout), not inline.
- After rule changes run `npm test` and `npm run sim -- 100` and note game-length / win-rate shifts.
- Keep docs/rules.md in sync with what the engine actually does.
- Bump `RULES_VERSION` (config.ts) whenever a change would make an old action log replay
  differently (rules, setup randomization, board). Bot changes don't need a bump. Saves refuse
  other versions, and so does the server (a stored game under other rules gets a 410).
- Server (`packages/server`): game state is never stored, only setup + action log (bot moves are
  logged like any other action, so replays don't depend on the bot). Every response with game
  data is built from `playerView` for the seat the bearer token belongs to; never take an actor
  id from the client. Seat tokens are stored only as sha256 hashes. Ended games, stale lobbies and
  games under other rules are deleted after `RETENTION_DAYS` (games.ts; docs/deploy.md).
- Scripted edits and one-off helper scripts use Node (`node script.mjs`), not Python: this is a
  Windows machine with no Python installed. Put the script in a file rather than `node -e`, since
  quotes and backslashes get mangled by the shell.

## Git workflow
- Start every piece of work on a new branch cut from an up-to-date `main`
  (`git fetch && git switch -c <branch> origin/main`). Never commit to `main` directly, and
  don't stack new work on an already-merged branch.
- When the work is done, commit, push and open a PR against `main`.
- Once the PR's CI checks pass, merge it without asking (`gh pr merge <n> --merge`, merge
  commits as before). GitHub auto-merge is turned off for this repo, so wait for the checks
  (`gh pr checks <n> --watch`) and then merge. If a check fails, or the PR has conflicts, fix it
  or report it instead of merging.
- Merging to `main` deploys to Fly. After a merge, check that the Deploy run succeeded and that
  `/api/health` reports the new commit.

## Commands
- `npm test`, `npm run typecheck`, `npm run build`, `npm run sim -- <games> [--config overrides.json]`
- `npm run diag -- <games> [--config overrides.json]`: per-archetype breakdown of 2-player games
  (monster/wizard/PvP results, defeats, rests, game time); use it to see *why* one side wins.
- `npm run replay -- playtests/<file>.json [--all]`: replay a saved game and print secrets,
  final state, stats and the full log. Local games autosave to `playtests/autosave/` (gitignored).
- `npm run dev`: local hot-seat test board (packages/client, Vite). It imports the engine
  source directly via an alias, so rule edits hot-reload; it only talks to the engine through
  `createGame` / `applyAction` / `playerView` / `botAction`, like the server does.
- `npm run server`: game server (packages/server, Fastify + `node:sqlite`, run with `tsx watch`,
  engine source via a tsconfig `paths` alias). Env: `FIRETOP_DB` (default `data/firetop.db`,
  gitignored), `PORT` (3000), `HOST` (127.0.0.1), `PUBLIC_URL` (invite link prefix). Its
  `build` typechecks, then bundles `src/main.ts` with esbuild into `dist/server.mjs` (engine and
  Fastify inlined) for the Docker image. Production also sets `FIRETOP_CLIENT_DIR` (serve the
  built client at /) and `FIRETOP_VERSION` (reported by `/api/health`).
- Deploy (M6): `Dockerfile`, `fly.toml`, `litestream.yml`, `start.sh` and `.github/workflows/`.
  See docs/deploy.md. Never run `fly` commands that create, scale or destroy resources without
  the user's go-ahead.
