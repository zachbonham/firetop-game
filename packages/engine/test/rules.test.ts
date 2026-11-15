import { describe, expect, it } from "vitest";
import { E, N, S, W, applyAction, openings, playerView, reachable, type GameState } from "../src/index.js";
import { act, newGame, patch, removeKey } from "./helpers.js";

const inMove = (s: GameState, roll: number) => patch(s, (x) => { x.phase = "move"; x.pendingRoll = roll; });

describe("turns", () => {
  it("only the current player may act", () => {
    const s = newGame();
    expect(applyAction(s, "p2", { type: "roll" })).toMatchObject({ ok: false, error: "not your turn" });
    expect(applyAction(s, "system", { type: "roll" }).ok).toBe(false);
  });
  it("never mutates the input state", () => {
    const s = newGame();
    const before = structuredClone(s);
    act(s, "p1", { type: "roll" });
    expect(s).toEqual(before);
  });
  it("roll then move passes the turn", () => {
    let s = act(newGame(), "p1", { type: "roll" });
    expect(s.phase).toBe("move");
    const to = [...reachable(s, s.players[0]!, s.pendingRoll!).keys()][0]!;
    s = act(s, "p1", { type: "move", to });
    expect(s.players[s.currentIndex]!.id).toBe("p2");
    expect(s.phase).toBe("roll");
  });
  it("replays identically from seed + actions", () => {
    const run = () => {
      let s = newGame(9);
      for (let i = 0; i < 6; i++) {
        const id = s.players[s.currentIndex]!.id;
        s = act(s, id, { type: "roll" });
        const to = [...reachable(s, s.players[s.currentIndex]!, s.pendingRoll!).keys()][0]!;
        s = act(s, id, { type: "move", to });
      }
      return s;
    };
    expect(run()).toEqual(run());
  });
});

describe("movement", () => {
  it("entering a location ends the move", () => {
    const s = newGame();
    const p = s.players[0]!;
    const opts = reachable(s, p, 6);
    // entrance -> r1 path is 2 squares, so r1.0 is reached at 3 and r1.1 is not reachable this move.
    expect(opts.get("r1.0")?.dist).toBe(3);
    expect(opts.has("r1.1")).toBe(false);
  });
  it("moving within a room does not stop you", () => {
    const s = patch(newGame(), (x) => { x.players[0]!.pos = "r3.0"; });
    const opts = reachable(s, s.players[0]!, 3);
    expect(opts.get("r3.2")?.dist).toBe(2);
    expect(opts.has("p:r3-r6.0")).toBe(true);
  });
  it("rejects a square you can't reach", () => {
    const s = inMove(newGame(), 1);
    expect(applyAction(s, "p1", { type: "move", to: "lair" }).ok).toBe(false);
  });
});

describe("encounters", () => {
  const enterRoom = (encounter: GameState["rooms"][string]["encounter"], tweak?: (s: GameState) => void) => {
    let s = patch(newGame(), (x) => {
      tweak?.(x);
      x.rooms.r1!.encounter = encounter;
      x.players[0]!.pos = "p:entrance-r1.1";
    });
    s = inMove(s, 1);
    return act(s, "p1", { type: "move", to: "r1.0" });
  };

  it("treasure keys and items go to the finder and clear the room", () => {
    const s = enterRoom({ kind: "treasure", item: "shield", key: 4 }, (x) => removeKey(x, 4));
    expect(s.players[0]!.keys).toContain(4);
    expect(s.players[0]!.items).toEqual(["shield"]);
    expect(s.rooms.r1!.cleared).toBe(true);
  });
  it("potions take effect when found", () => {
    const s = enterRoom({ kind: "treasure", item: "luckPotion", key: null });
    expect(s.players[0]!.luck).toBe(1 + 2);
    expect(s.players[0]!.items).toEqual([]);
  });
  it("traps cost Stamina", () => {
    const s = enterRoom({ kind: "trap", damage: 3 });
    expect(s.players[0]!.stamina).toBe(11);
  });
  it("a hopeless fight makes you flee back one square", () => {
    const s = enterRoom({ kind: "monster", name: "Dragon", skill: 30, stamina: 50, loot: null }, (x) => {
      x.players[0]!.settings.fleeBelow = 10;
    });
    expect(s.players[0]!.pos).toBe("p:entrance-r1.1");
    expect(s.rooms.r1!.revealed).toBe(true);
    expect(s.rooms.r1!.cleared).toBe(false);
  });
  it("losing a fight drops your keys, sends you to the entrance and skips a turn", () => {
    const s = enterRoom({ kind: "monster", name: "Dragon", skill: 30, stamina: 50, loot: null }, (x) => {
      x.players[0]!.settings.fleeBelow = 0;
      x.players[0]!.settings.autoLuck = false;
      removeKey(x, 2);
      x.players[0]!.keys = [2];
    });
    const p = s.players[0]!;
    expect(p.pos).toBe("entrance");
    expect(p.keys).toEqual([]);
    expect(s.dropped["r1.0"]).toEqual([2]);
    expect(p.skipNextTurn).toBe(true);
    expect(p.stamina).toBe(7);
  });
  it("rest restores Stamina up to the maximum", () => {
    const s = act(patch(newGame(), (x) => { x.players[0]!.stamina = 12; }), "p1", { type: "rest" });
    expect(s.players[0]!.stamina).toBe(14);
  });
});

describe("maze", () => {
  it("flipping a tile ends the move and asks for a rotation", () => {
    let s = patch(newGame(), (x) => { x.players[0]!.pos = "maze"; });
    s = inMove(s, 3);
    const opts = reachable(s, s.players[0]!, 3);
    expect(opts.get("m:1:0")).toMatchObject({ flip: true, entrySide: W });
    s = act(s, "p1", { type: "move", to: "m:1:0" });
    expect(s.phase).toBe("orient");
    const view = playerView(s, "p1");
    expect(view.me!.pendingFlip).toMatchObject({ row: 1, col: 0, entrySide: W });
    const type = view.me!.pendingFlip!.type;
    const bad = [0, 1, 2, 3].find((r) => !(openings(type, r) & W));
    if (bad !== undefined) expect(applyAction(s, "p1", { type: "orientTile", rotation: bad }).ok).toBe(false);
    const good = [0, 1, 2, 3].find((r) => openings(type, r) & W)!;
    s = act(s, "p1", { type: "orientTile", rotation: good });
    expect(s.players[0]!.maze["1:0"]).toBe(good);
    expect(s.players[s.currentIndex]!.id).toBe("p2");
  });
  it("views are private: other players see neither your tiles nor your position", () => {
    const s = patch(newGame(), (x) => {
      x.players[0]!.pos = "m:1:0";
      x.players[0]!.maze = { "1:0": 0 };
    });
    const v = playerView(s, "p2");
    expect(v.players[0]!.pos).toBe("maze:hidden");
    expect(v.players[0]!.inMaze).toBe(true);
    expect(v.me!.maze).toEqual([]);
    expect(playerView(s, "p1").me!.maze).toHaveLength(1);
  });
  it("you can re-turn your own tile or an adjacent revealed tile, not a far one", () => {
    const s = patch(newGame(), (x) => {
      x.players[0]!.pos = "m:1:0";
      x.players[0]!.maze = { "1:0": 0, "1:1": 0, "3:3": 0 };
    });
    expect(applyAction(s, "p1", { type: "rotateTile", row: 1, col: 1, rotation: 2 }).ok).toBe(true);
    expect(applyAction(s, "p1", { type: "rotateTile", row: 3, col: 3, rotation: 2 }).ok).toBe(false);
    expect(applyAction(s, "p1", { type: "rotateTile", row: 0, col: 0, rotation: 2 }).ok).toBe(false);
  });
  it("crossing the east edge reaches the lair and starts the duel", () => {
    let s = patch(newGame(), (x) => {
      x.mazeTiles[1 * 4 + 3] = "straight";
      x.players[0]!.pos = "m:1:3";
      x.players[0]!.maze = { "1:3": 1 }; // straight turned once = E|W
      x.players[0]!.skill = 30;
    });
    expect(openings("straight", 1)).toBe(E | W);
    s = inMove(s, 1);
    s = act(s, "p1", { type: "move", to: "lair" });
    expect(s.players[0]!.pos).toBe("lair");
    expect(s.players[0]!.wizardBeaten).toBe(true);
    void N; void S;
  });
});

describe("the chest", () => {
  const atChest = (keys: number[]) =>
    patch(newGame(), (x) => {
      x.players[0]!.pos = "lair";
      x.players[0]!.wizardBeaten = true;
      x.players[0]!.keys = keys;
    });

  it("the right 3 keys win", () => {
    const base = newGame();
    const s = act(atChest([...base.combination]), "p1", { type: "guessChest", keys: [...base.combination] });
    expect(s.phase).toBe("finished");
    expect(s.winner).toBe("p1");
  });
  it("a wrong guess is public, reports the count and costs 3 Stamina", () => {
    const base = newGame();
    const wrong = [1, 2, 3, 4, 5, 6, 7].filter((k) => !base.combination.includes(k)).slice(0, 2);
    const guess = [base.combination[0]!, ...wrong];
    const s = act(atChest(guess), "p1", { type: "guessChest", keys: guess });
    expect(s.guesses).toEqual([{ playerId: "p1", keys: [...guess].sort((a, b) => a - b), correct: 1, turn: 1 }]);
    expect(s.players[0]!.stamina).toBe(11);
    expect(playerView(s, "p2").guesses).toHaveLength(1);
  });
  it("needs the wizard beaten and keys you actually hold", () => {
    const s = patch(atChest([1, 2, 3]), (x) => { x.players[0]!.wizardBeaten = false; });
    expect(applyAction(s, "p1", { type: "guessChest", keys: [1, 2, 3] }).ok).toBe(false);
    expect(applyAction(atChest([1, 2]), "p1", { type: "guessChest", keys: [1, 2, 3] }).ok).toBe(false);
  });
  it("you can't roll while in the lair", () => {
    expect(applyAction(atChest([]), "p1", { type: "roll" }).ok).toBe(false);
  });
});

describe("player vs player", () => {
  const sharing = () =>
    patch(newGame(), (x) => {
      x.players[0]!.pos = "r1.0";
      x.players[1]!.pos = "r1.0";
      x.players[0]!.skill = 40;
      x.players[1]!.keys = [5];
      x.players[1]!.settings.fleeBelow = 0;
      removeKey(x, 5);
    });

  it("the winner takes one key and the loser is protected", () => {
    const s = act(sharing(), "p1", { type: "attack", target: "p2", stealKey: 5 });
    expect(s.players[0]!.keys).toEqual([5]);
    expect(s.players[1]!.keys).toEqual([]);
  });
  it("a protected player can't be attacked", () => {
    const s = patch(sharing(), (x) => { x.players[1]!.protected = true; });
    expect(applyAction(s, "p1", { type: "attack", target: "p2" }).ok).toBe(false);
  });
});

describe("timer", () => {
  it("a timeout skips the turn and three in a row remove the player", () => {
    let s = newGame(1, 3);
    for (let round = 0; round < 3; round++) {
      s = act(s, "system", { type: "timeout" }); // p1 times out
      s = act(s, "p2", { type: "rest" });
      s = act(s, "p3", { type: "rest" });
    }
    expect(s.players[0]!.status).toBe("removed");
  });
  it("the last player left wins", () => {
    let s = newGame(1, 2);
    s = act(s, "system", { type: "timeout" });
    s = act(s, "p2", { type: "rest" });
    s = act(s, "system", { type: "timeout" });
    s = act(s, "p2", { type: "rest" });
    s = act(s, "system", { type: "timeout" });
    expect(s.phase).toBe("finished");
    expect(s.winner).toBe("p2");
  });
  it("a timeout during orient turns the flipped tile automatically", () => {
    let s = patch(newGame(), (x) => { x.players[0]!.pos = "maze"; });
    s = inMove(s, 1);
    s = act(s, "p1", { type: "move", to: "m:1:0" });
    s = act(s, "system", { type: "timeout" });
    expect(s.players[0]!.maze["1:0"]).toBeDefined();
    expect(s.phase).toBe("roll");
  });
  it("only the server can send a timeout", () => {
    expect(applyAction(newGame(), "p1", { type: "timeout" }).ok).toBe(false);
  });
});

describe("items", () => {
  const holding = (items: GameState["players"][number]["items"], tweak?: (s: GameState) => void) =>
    patch(newGame(), (x) => {
      x.players[0]!.items = [...items];
      tweak?.(x);
    });

  it("provisions are a free action: they heal and the turn goes on", () => {
    const s = act(holding(["provisions"], (x) => { x.players[0]!.stamina = 5; }), "p1", { type: "useItem", item: "provisions" });
    expect(s.players[0]!.stamina).toBe(9);
    expect(s.players[0]!.items).toEqual([]);
    expect(s.currentIndex).toBe(0);
    expect(s.phase).toBe("roll");
  });
  it("items can't be used after rolling, twice, or if they work automatically", () => {
    const s = holding(["provisions", "sword"], (x) => { x.players[0]!.stamina = 5; });
    expect(applyAction(inMove(s, 3), "p1", { type: "useItem", item: "provisions" }).ok).toBe(false);
    expect(applyAction(s, "p1", { type: "useItem", item: "sword" }).ok).toBe(false);
    expect(applyAction(s, "p1", { type: "useItem", item: "scroll" }).ok).toBe(false);
    expect(applyAction(holding(["provisions"]), "p1", { type: "useItem", item: "provisions" }).ok).toBe(false);
  });
  it("a scroll shows one room's contents to the reader only", () => {
    const s = act(holding(["scroll"]), "p1", { type: "useItem", item: "scroll", room: "r5" });
    expect(s.rooms.r5!.revealed).toBe(false);
    expect(playerView(s, "p1").me!.peeks.r5).toBeDefined();
    expect(playerView(s, "p2").me!.peeks.r5).toBeUndefined();
    expect(JSON.stringify(playerView(s, "p2"))).not.toContain("The scroll shows");
    expect(applyAction(patch(s, (x) => { x.players[0]!.items = ["scroll"]; }), "p1", { type: "useItem", item: "scroll", room: "r5" }).ok).toBe(false);
  });
  it("the sword helps against monsters", () => {
    // Skill 10 + sword 1 vs an equal Skill-11 monster across many seeds: the sword should win more often.
    const wins = (items: GameState["players"][number]["items"]) => {
      let n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        let s = patch(newGame(seed), (x) => {
          x.players[0]!.items = [...items];
          x.players[0]!.settings.fleeBelow = 0;
          x.players[0]!.settings.autoLuck = false;
          x.rooms.r1!.encounter = { kind: "monster", name: "Duelist", skill: 11, stamina: 14, loot: null };
          x.players[0]!.pos = "p:entrance-r1.1";
        });
        s = act(inMove(s, 1), "p1", { type: "move", to: "r1.0" });
        if (s.rooms.r1!.cleared) n++;
      }
      return n;
    };
    expect(wins(["sword"])).toBeGreaterThan(wins([]));
  });
  it("the amulet keeps your keys once", () => {
    const s = patch(newGame(), (x) => {
      removeKey(x, 3);
      x.players[0]!.keys = [3];
      x.players[0]!.items = ["amulet"];
      x.players[0]!.settings.fleeBelow = 0;
      x.players[0]!.settings.autoLuck = false;
      x.rooms.r1!.encounter = { kind: "monster", name: "Dragon", skill: 30, stamina: 50, loot: null };
      x.players[0]!.pos = "p:entrance-r1.1";
    });
    const after = act(inMove(s, 1), "p1", { type: "move", to: "r1.0" });
    expect(after.players[0]!.keys).toEqual([3]);
    expect(after.players[0]!.items).toEqual([]);
    expect(after.dropped).toEqual({});
  });
});

describe("camp", () => {
  it("entering the camp marks it, and later defeats wake you there", () => {
    let s = patch(newGame(), (x) => { x.players[0]!.pos = "p:r4-camp.0"; });
    s = act(inMove(s, 1), "p1", { type: "move", to: "camp" });
    expect(s.players[0]!.campReached).toBe(true);
    s = patch(s, (x) => {
      x.currentIndex = 0;
      x.players[0]!.settings.fleeBelow = 0;
      x.players[0]!.settings.autoLuck = false;
      x.rooms.r6!.encounter = { kind: "monster", name: "Dragon", skill: 30, stamina: 50, loot: null };
      x.players[0]!.pos = "p:camp-r6.0";
    });
    s = act(inMove(s, 1), "p1", { type: "move", to: "r6.0" });
    expect(s.players[0]!.pos).toBe("camp");
    expect(s.players[0]!.skipNextTurn).toBe(true);
  });
});
