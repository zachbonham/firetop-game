import { applyAction, createGame, type Action, type GameState } from "../src/index.js";

export function newGame(seed = 1, n = 2): GameState {
  const arch = ["warrior", "survivor", "lucky", "warrior"] as const;
  return createGame({
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, archetype: arch[i]! })),
  });
}

export function act(s: GameState, actor: string, a: Action): GameState {
  const r = applyAction(s, actor, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** Take key `k` out of whatever room setup hid it in (to keep invariants when a test hands it out). */
export function removeKey(s: GameState, k: number) {
  for (const r of Object.values(s.rooms)) {
    const e = r.encounter;
    if (e.kind === "monster" && e.loot === k) e.loot = null;
    if (e.kind === "treasure" && e.key === k) e.key = null;
  }
}

/** Edit a state directly to set up a scenario (tests only). */
export function patch(s: GameState, fn: (s: GameState) => void): GameState {
  const c = structuredClone(s);
  fn(c);
  return c;
}
