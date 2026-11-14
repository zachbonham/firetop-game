import { describe, expect, it } from "vitest";
import { Rng, seedFromString } from "../src/index.js";

describe("Rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng(42), b = new Rng(42);
    expect(Array.from({ length: 20 }, () => a.d6())).toEqual(Array.from({ length: 20 }, () => b.d6()));
  });
  it("rolls d6 in range with every face", () => {
    const r = new Rng(7);
    const faces = new Set(Array.from({ length: 600 }, () => r.d6()));
    expect([...faces].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("hashes string seeds", () => {
    expect(seedFromString("abc")).toBe(seedFromString("abc"));
    expect(seedFromString("abc")).not.toBe(seedFromString("abd"));
  });
});
