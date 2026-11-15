import { botAction, playerView } from "@firetop/engine";
import { describe, expect, it } from "vitest";
import { act, fromSave, startSession, toSave, undo, undoHumanTurn, type Session, type SessionSetup } from "../src/session.js";

const setup: SessionSetup = {
  seed: 42,
  seats: [
    { id: "a", name: "Ann", archetype: "warrior", bot: false },
    { id: "b", name: "Bo", archetype: "lucky", bot: true },
  ],
  config: { restAmount: 3 },
};

function botStep(s: Session): Session {
  const actor = s.state.players[s.state.currentIndex]!.id;
  const r = act(s, actor, botAction(playerView(s.state, actor)));
  if (!r.ok) throw new Error(r.error);
  return r.session;
}

describe("local session", () => {
  it("applies config overrides", () => {
    expect(startSession(setup).state.config.restAmount).toBe(3);
  });

  it("rejects illegal actions without recording them", () => {
    const s = startSession(setup);
    const r = act(s, "b", { type: "roll" });
    expect(r.ok).toBe(false);
    expect(s.actions).toEqual([]);
  });

  it("save -> load replays to the same state", () => {
    let s = startSession(setup);
    for (let i = 0; i < 60 && s.state.phase !== "finished"; i++) s = botStep(s);
    const loaded = fromSave(JSON.parse(JSON.stringify(toSave(s))));
    expect(loaded.state).toEqual(s.state);
  });

  it("undo steps back one action; undoHumanTurn skips past bot actions", () => {
    let s = startSession(setup);
    const s0 = s;
    s = botStep(s); // Ann (human seat, driven here by the bot)
    const s1 = s;
    s = botStep(s);
    expect(undo(s).state).toEqual(s1.state);
    // Play until Bo has acted, then undoing Ann's turn removes Bo's actions too.
    while (s.state.players[s.state.currentIndex]!.id !== "a") s = botStep(s);
    const humanActs = s.actions.filter((x) => x.actor === "a").length;
    const back = undoHumanTurn(s);
    expect(back.actions.filter((x) => x.actor === "a").length).toBe(humanActs - 1);
    expect(back.actions.at(-1)?.actor ?? null).not.toBe("b");
    expect(undoHumanTurn(startSession(setup)).state).toEqual(s0.state);
  });

  it("refuses foreign save files", () => {
    expect(() => fromSave({ hello: 1 })).toThrow();
  });
});
