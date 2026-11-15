import { botAction, playerView } from "@firetop/engine";
import { describe, expect, it } from "vitest";
import { cardsBetween, roomCard, sinceMyLastTurn } from "../src/Cards.js";
import { act, startSession, type Session, type SessionSetup } from "../src/session.js";

const setup: SessionSetup = {
  seed: 7,
  seats: [
    { id: "a", name: "Ann", archetype: "warrior", bot: false },
    { id: "b", name: "Bo", archetype: "lucky", bot: true },
  ],
  config: {},
};

/** Play bot moves for everyone until `pred` holds after one of Ann's actions; returns the views around it. */
function untilAnn(pred: (before: Session, after: Session) => boolean) {
  let s = startSession(setup);
  for (let i = 0; i < 3000; i++) {
    const actor = s.state.players[s.state.currentIndex]!.id;
    const r = act(s, actor, botAction(playerView(s.state, actor)));
    if (!r.ok) throw new Error(r.error);
    if (actor === "a" && pred(s, r.session)) return { before: s, after: r.session };
    s = r.session;
  }
  throw new Error("never happened");
}

describe("cards", () => {
  it("shows the room Ann just revealed, with what happened there", () => {
    const { before, after } = untilAnn((b, a) =>
      Object.keys(a.state.rooms).some((id) => a.state.rooms[id]!.revealed && !b.state.rooms[id]!.revealed));
    const cards = cardsBetween(playerView(before.state, "a"), playerView(after.state, "a"));
    const room = Object.keys(after.state.rooms).find((id) => after.state.rooms[id]!.revealed && !before.state.rooms[id]!.revealed)!;
    expect(cards[0]!.subtitle).toContain(room.toUpperCase());
    expect(cards[0]!.lines!.length).toBeGreaterThan(0);
  });

  it("only uses what the viewer can see", () => {
    const { before, after } = untilAnn((b, a) => a.state.log.length > b.state.log.length);
    const cards = cardsBetween(playerView(before.state, "a"), playerView(after.state, "a"));
    const text = JSON.stringify(cards);
    for (const [id, r] of Object.entries(after.state.rooms)) {
      if (r.revealed || r.encounter.kind !== "monster" || r.encounter.loot === null) continue;
      expect(text).not.toContain(`Room ${id.toUpperCase()}`);
    }
    expect(text).not.toContain("combination");
  });

  it("ignores what other players did after the viewer's action (the server plays bots straight after you)", () => {
    // Find one of Ann's actions followed by Bo revealing a room, like an online act response.
    let s = startSession(setup);
    for (let i = 0; i < 3000; i++) {
      const actor = s.state.players[s.state.currentIndex]!.id;
      const r = act(s, actor, botAction(playerView(s.state, actor)));
      if (!r.ok) throw new Error(r.error);
      if (actor === "a") {
        let later = r.session;
        while (later.state.phase !== "finished" && later.state.players[later.state.currentIndex]!.id === "b") {
          const b = act(later, "b", botAction(playerView(later.state, "b")));
          if (!b.ok) throw new Error(b.error);
          later = b.session;
        }
        const boRevealed = Object.keys(later.state.rooms).some((id) => later.state.rooms[id]!.revealed && !r.session.state.rooms[id]!.revealed);
        if (boRevealed) {
          const before = playerView(s.state, "a");
          expect(cardsBetween(before, playerView(later.state, "a"))).toEqual(cardsBetween(before, playerView(r.session.state, "a")));
          // ...and Bo's moves are in Ann's "since your last turn" feed instead.
          const feed = sinceMyLastTurn(playerView(later.state, "a"));
          expect(feed.length).toBeGreaterThan(0);
          expect(feed.every((e) => e.turn > s.state.turn)).toBe(true);
          expect(feed.some((e) => e.playerId === "b" && e.room)).toBe(true);
          return;
        }
      }
      s = r.session;
    }
    throw new Error("never happened");
  });

  it("feeds back only turns after the viewer's last one", () => {
    const { after } = untilAnn((b, a) => a.state.turn > b.state.turn && a.state.turn > 6);
    const v = playerView(after.state, "a"); // Bo's turn now; Ann's was the turn before
    expect(sinceMyLastTurn(v).every((e) => e.turn === v.turn)).toBe(true);
  });

  it("makes no cards across different viewers or with nothing new", () => {
    const s = startSession(setup);
    expect(cardsBetween(playerView(s.state, "a"), playerView(s.state, "a"))).toEqual([]);
    expect(cardsBetween(playerView(s.state, "a"), playerView(s.state, "b"))).toEqual([]);
  });

  it("describes treasure, keys and a scroll's secret", () => {
    const c = roomCard("r3", { kind: "treasure", item: "shield", key: 5 }, { secret: true });
    expect(c.title).toBe("Shield");
    expect(c.stats).toEqual([["Key", 5]]);
    expect(c.tone).toBe("secret");
    expect(c.lines!.join(" ")).toContain("Only you");
  });
});
