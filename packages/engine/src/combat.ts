import type { Rng } from "./rng.js";

export interface Fighter {
  skill: number;
  stamina: number;
  luck: number;
  /** Flee once Stamina drops below this; 0 or null never flees. */
  fleeBelow: number | null;
  autoLuck: boolean;
  /** Damage blocked per lost round (shield); a lost round always costs at least 1. */
  block?: number;
}

export interface CombatResult {
  /** "a" or "b" won; the other either fled or dropped to 0 Stamina. */
  winner: "a" | "b";
  fled: "a" | "b" | null;
  a: Fighter;
  b: Fighter;
  rounds: number;
  luckSpent: { a: number; b: number };
}

const MAX_ROUNDS = 200;

/**
 * Resolve a whole fight in one call (async-friendly: no back-and-forth).
 * Each round both sides roll 2d6 + Skill; the lower roll loses `damage`
 * Stamina (less any block, minimum 1); ties do nothing. A side that is losing a round may spend a Luck
 * token to reroll once if autoLuck is on. A side below its fleeBelow runs
 * away before the next round, losing `fleeDamage` Stamina as it goes.
 */
export function resolveCombat(a0: Fighter, b0: Fighter, rng: Rng, damage: number, fleeDamage = 0): CombatResult {
  const a = { ...a0 };
  const b = { ...b0 };
  const luckSpent = { a: 0, b: 0 };
  const wantsToFlee = (f: Fighter) => f.fleeBelow !== null && f.fleeBelow > 0 && f.stamina < f.fleeBelow;

  // Fleeing costs a parting blow; if that drops you to 0 you fall instead.
  const flee = (f: Fighter) => {
    f.stamina = Math.max(0, f.stamina - fleeDamage);
    return f.stamina > 0;
  };
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (wantsToFlee(a)) return { winner: "b", fled: flee(a) ? "a" : null, a, b, rounds: round - 1, luckSpent };
    if (wantsToFlee(b)) return { winner: "a", fled: flee(b) ? "b" : null, a, b, rounds: round - 1, luckSpent };

    let ra = rng.twoD6() + a.skill;
    let rb = rng.twoD6() + b.skill;
    if (ra < rb && a.autoLuck && a.luck > 0) {
      a.luck--;
      luckSpent.a++;
      ra = rng.twoD6() + a.skill;
    } else if (rb < ra && b.autoLuck && b.luck > 0) {
      b.luck--;
      luckSpent.b++;
      rb = rng.twoD6() + b.skill;
    }
    const hit = (f: Fighter) => Math.max(1, damage - (f.block ?? 0));
    if (ra > rb) b.stamina = Math.max(0, b.stamina - hit(b));
    else if (rb > ra) a.stamina = Math.max(0, a.stamina - hit(a));

    if (b.stamina <= 0) return { winner: "a", fled: null, a, b, rounds: round, luckSpent };
    if (a.stamina <= 0) return { winner: "b", fled: null, a, b, rounds: round, luckSpent };
  }
  // Stalemate safety valve: the attacker gives up.
  return { winner: "b", fled: "a", a, b, rounds: MAX_ROUNDS, luckSpent };
}
