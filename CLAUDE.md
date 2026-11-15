# CLAUDE.md

Async multiplayer board game (Warlock of Firetop Mountain inspired). See README.md and docs/.

## Conventions
- TypeScript everywhere, npm workspaces (`packages/*`), Node 20+, ESM, strict TS with
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
  other versions.

## Commands
- `npm test`, `npm run typecheck`, `npm run build`, `npm run sim -- <games> [--config overrides.json]`
- `npm run diag -- <games> [--config overrides.json]`: per-archetype breakdown of 2-player games
  (monster/wizard/PvP results, defeats, rests, game time); use it to see *why* one side wins.
- `npm run replay -- playtests/<file>.json [--all]`: replay a saved game and print secrets,
  final state, stats and the full log. Local games autosave to `playtests/autosave/` (gitignored).
- `npm run dev`: local hot-seat test board (packages/client, Vite). It imports the engine
  source directly via an alias, so rule edits hot-reload; it only talks to the engine through
  `createGame` / `applyAction` / `playerView` / `botAction`, like the future server will.
