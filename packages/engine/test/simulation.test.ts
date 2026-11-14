import { describe, expect, it } from "vitest";
import type { Archetype } from "../src/index.js";
import { simulate } from "../sim/run.js";

const ARCH: Archetype[] = ["warrior", "survivor", "lucky"];

describe("simulated games (scripted bots, invariants checked after every action)", () => {
  for (const n of [2, 3, 4]) {
    it(`${n}-player games all finish with a winner`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const arch = Array.from({ length: n }, (_, i) => ARCH[(seed + i) % 3]!);
        const r = simulate(seed * 101 + n, arch, 6000);
        expect(r.finished, `seed ${seed}`).toBe(true);
        expect(r.winner).not.toBeNull();
      }
    });
  }
});
