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

## Commands
- `npm test`, `npm run typecheck`, `npm run build`, `npm run sim -- <games>`
