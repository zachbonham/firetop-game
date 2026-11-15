import { describe, expect, it } from "vitest";
import { checkInvariants, createGame, isSolvable } from "../src/index.js";
import { newGame } from "./helpers.js";

describe("createGame", () => {
  it("is deterministic per seed", () => {
    expect(newGame(5)).toEqual(newGame(5));
    expect(newGame(5)).not.toEqual(newGame(6));
  });
  it("hides all 7 keys exactly once and picks a 3-key combination", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = newGame(seed);
      expect(checkInvariants(s)).toEqual([]);
      expect(new Set(s.combination).size).toBe(3);
      expect(s.combination.every((k) => k >= 1 && k <= 7)).toBe(true);
    }
  });
  it("always deals a crossable maze", () => {
    for (let seed = 1; seed <= 200; seed++) expect(isSolvable(newGame(seed).mazeTiles)).toBe(true);
  });
  it("rejects bad player counts and duplicate ids", () => {
    expect(() => createGame({ seed: 1, players: [{ id: "a", name: "A", archetype: "warrior" }] })).toThrow();
    expect(() =>
      createGame({ seed: 1, players: [{ id: "a", name: "A", archetype: "warrior" }, { id: "a", name: "B", archetype: "lucky" }] }),
    ).toThrow();
  });
  it("takes archetype stats from config overrides", () => {
    const s = createGame({
      seed: 1,
      players: [{ id: "a", name: "A", archetype: "warrior" }, { id: "b", name: "B", archetype: "lucky" }],
      config: {
        archetypes: {
          warrior: { skill: 9, stamina: 16, luck: 2 },
          survivor: { skill: 8, stamina: 20, luck: 2 },
          lucky: { skill: 7, stamina: 15, luck: 5 },
        },
      },
    });
    expect(s.players.map((p) => [p.skill, p.maxStamina, p.luck])).toEqual([[9, 16, 2], [7, 15, 5]]);
  });
  it("starts everyone at the entrance with archetype stats", () => {
    const s = newGame(1, 3);
    expect(s.players.map((p) => p.pos)).toEqual(["entrance", "entrance", "entrance"]);
    expect(s.players[0]!.skill).toBe(10);
    expect(s.players[1]!.maxStamina).toBe(20);
    expect(s.players[2]!.luck).toBe(4);
  });
});
