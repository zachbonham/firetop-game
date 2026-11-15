import { describe, expect, it } from "vitest";
import { BOARD, CAMP, ENTRANCE, LAIR, MAZE_SQUARE, boardDistances, locationOf } from "../src/index.js";

describe("board", () => {
  it("has 14 locations", () => {
    const locs = new Set(Object.values(BOARD.squares).map((s) => s.location).filter(Boolean));
    expect(locs.size).toBe(14);
  });
  it("the camp joins r4 to r6 and r7", () => {
    const d = boardDistances(CAMP);
    expect(d.get("r4.1")).toBe(2);
    expect(d.get("r6.0")).toBe(2);
    expect(d.get("r7.0")).toBe(2);
  });
  it("links are symmetric", () => {
    for (const sq of Object.values(BOARD.squares)) {
      for (const n of sq.neighbors) expect(BOARD.squares[n]!.neighbors).toContain(sq.id);
    }
  });
  it("every room and the maze are reachable from the entrance", () => {
    const d = boardDistances(ENTRANCE);
    for (const room of BOARD.rooms) expect(d.has(`${room}.0`)).toBe(true);
    expect(d.has(MAZE_SQUARE)).toBe(true);
  });
  it("the lair is only reachable through the maze grid", () => {
    expect(boardDistances(ENTRANCE).has(LAIR)).toBe(false);
    expect(locationOf("m:0:0")).toBe("maze");
  });
});
