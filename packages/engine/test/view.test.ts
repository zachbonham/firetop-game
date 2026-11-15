import { describe, expect, it } from "vitest";
import { applyAction, botAction, playerView } from "../src/index.js";
import { newGame } from "./helpers.js";

describe("playerView never leaks secrets", () => {
  it("omits combination, maze deal, RNG and hidden encounters", () => {
    let s = newGame(3, 3);
    for (let i = 0; i < 150 && s.phase !== "finished"; i++) {
      const id = s.players[s.currentIndex]!.id;
      const r = applyAction(s, id, botAction(playerView(s, id)));
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
        expect(json).not.toContain('"peeks":["');
        for (const p of s.players) {
          if (p.id === viewer.id) continue;
          for (const room of p.peeks) if (!viewer.peeks.includes(room) && !s.rooms[room]!.revealed) expect(v.me!.peeks[room]).toBeUndefined();
        }
        for (const [id, room] of Object.entries(s.rooms)) {
          if (!room.revealed) expect(v.rooms[id]!.encounter).toBeUndefined();
        }
        for (const p of s.players) {
          if (p.id === viewer.id) continue;
          expect(json).not.toContain(`"${p.pos}"`.startsWith('"m:') ? `"${p.pos}"` : "\u0000never");
        }
        expect(v.log.every((e) => !e.privateTo || e.privateTo === viewer.id)).toBe(true);
        // A room named in the log is one whose contents are already public.
        expect(v.log.every((e) => !e.room || v.rooms[e.room]?.revealed)).toBe(true);
      }
    }
  });
  it("includes the public rule config", () => {
    const s = newGame();
    expect(playerView(s, "p1").config).toEqual(s.config);
  });
  it("a spectator view has no 'me' section", () => {
    expect(playerView(newGame(), null).me).toBeUndefined();
  });
});
