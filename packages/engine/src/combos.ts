import type { ChestGuess } from "./types.js";

/** All k-subsets of 1..n, sorted ascending. */
export function allCombos(n: number, k: number): number[][] {
  const out: number[][] = [];
  const walk = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i <= n; i++) {
      acc.push(i);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(1, []);
  return out;
}

export function overlap(a: readonly number[], b: readonly number[]): number {
  return a.filter((x) => b.includes(x)).length;
}

/** Combinations still consistent with every public wrong guess. */
export function candidateCombos(n: number, k: number, guesses: readonly ChestGuess[]): number[][] {
  return allCombos(n, k).filter((combo) => guesses.every((g) => overlap(combo, g.keys) === g.correct));
}
