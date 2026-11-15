import { BOARD, isMazeTile } from "./board.js";
import { MAZE_SIZE } from "./maze.js";
import type { GameState } from "./types.js";

/** Returns a list of broken invariants (empty = healthy). Used by tests and sims. */
export function checkInvariants(s: GameState): string[] {
  const errors: string[] = [];
  const n = s.config.keyCount;

  const seen: number[] = [];
  for (const p of s.players) seen.push(...p.keys);
  for (const keys of Object.values(s.dropped)) seen.push(...keys);
  for (const r of Object.values(s.rooms)) {
    const e = r.encounter;
    if (r.cleared) continue;
    if (e.kind === "monster" && e.loot !== null) seen.push(e.loot);
    if (e.kind === "treasure" && e.key !== null) seen.push(e.key);
  }
  const sorted = [...seen].sort((a, b) => a - b);
  const expected = Array.from({ length: n }, (_, i) => i + 1);
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
    errors.push(`keys not conserved: ${JSON.stringify(sorted)}`);
  }

  for (const p of s.players) {
    if (p.stamina < 0 || p.stamina > p.maxStamina) errors.push(`${p.id} stamina out of range: ${p.stamina}`);
    if (p.luck < 0) errors.push(`${p.id} negative luck`);
    if (isMazeTile(p.pos)) {
      const key = p.pos.slice(2);
      const flipping = s.pendingFlip && s.players[s.currentIndex] === p && `${s.pendingFlip.row}:${s.pendingFlip.col}` === key;
      if (!(key in p.maze) && !flipping) errors.push(`${p.id} stands on a tile they haven't revealed`);
    } else if (!BOARD.squares[p.pos]) {
      errors.push(`${p.id} on unknown square ${p.pos}`);
    }
    for (const [key, rot] of Object.entries(p.maze)) {
      const [r, c] = key.split(":").map(Number) as [number, number];
      if (r < 0 || c < 0 || r >= MAZE_SIZE || c >= MAZE_SIZE || rot < 0 || rot > 3) {
        errors.push(`${p.id} bad maze entry ${key}=${rot}`);
      }
    }
  }
  if (s.combination.length !== s.config.comboSize) errors.push("bad combination size");
  if (s.phase === "finished" && s.winner === null && s.players.some((p) => p.status === "active")) {
    errors.push("finished without a winner");
  }
  return errors;
}
