import { createGame, playerView, type GameState } from "@firetop/engine";
import { describe, expect, it } from "vitest";
import { keepsWayBack } from "../src/ActionPanel.js";

/** Zach's production maze, standing on (0,2) after coming up from (1,2). */
function zach(): GameState {
  const s = createGame({ seed: 1, players: [{ id: "p1", name: "Zach", archetype: "warrior" }, { id: "p2", name: "Bo", archetype: "lucky" }] });
  for (const [r, c, t] of [[1, 0, "cross"], [1, 1, "tee"], [1, 2, "corner"], [0, 2, "corner"]] as const) s.mazeTiles[r * 4 + c] = t;
  s.players[0]!.maze = { "1:0": 0, "1:1": 3, "1:2": 3, "0:2": 2 };
  s.players[0]!.pos = "m:0:2";
  return s;
}

describe("re-turn picker", () => {
  it("disables rotations that would cut you off, like the engine", () => {
    const view = playerView(zach(), "p1");
    expect(keepsWayBack(view, 0, 2, 0)).toBe(false); // north-east: no way back south
    expect(keepsWayBack(view, 0, 2, 1)).toBe(true); // east-south: way back kept
    expect(keepsWayBack(view, 1, 2, 1)).toBe(false); // turning the tile behind you away
  });
});
