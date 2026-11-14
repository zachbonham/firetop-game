import { describe, expect, it } from "vitest";
import { applyAction, playerView } from "../src/index.js";
import { newGame } from "./helpers.js";
import { decide } from "../sim/bot.js";

describe("playerView never leaks secrets", () => {
  it("omits combination, maze deal, RNG and hidden encounters", () => {
    let s = newGame(3, 3);
    for (let i = 0; i < 150 && s.phase !== "finished"; i++) {
      const id = s.players[s.currentIndex]!.id;
      const r = applyAction(s, id, decide(playerView(s, id)));
      if (!r.ok) throw new Error(r.error);
      s = r.state;
      for (const viewer of s.players) {
        const v = playerView(s, viewer.id);
        const json = JSON.stringify(v);
        expect(json).not.toContain("combination");
        expect(json).not.toContain("mazeTiles");
        expect(json).not.toContain('"rng"');
        expect(json).not.toContain('"seed"');
        expect(json).not.toContain('"loot"');
        for (const [id, room] of Object.entries(s.rooms)) {
          if (!room.revealed) expect(v.rooms[id]!.encounter).toBeUndefined();
        }
        for (const p of s.players) {
          if (p.id === viewer.id) continue;
          expect(json).not.toContain(`"${p.pos}"`.startsWith('"m:') ? `"${p.pos}"` : "\u0000never");
        }
        expect(v.log.every((e) => !e.privateTo || e.privateTo === viewer.id)).toBe(true);
      }
    }
  });
  it("a spectator view has no 'me' section", () => {
    expect(playerView(newGame(), null).me).toBeUndefined();
  });
});
