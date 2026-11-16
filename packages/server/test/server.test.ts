import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RULES_VERSION, botAction, type Action, type GameState, type PlayerView } from "@firetop/engine";
import { buildServer, type Server } from "../src/app.js";
import type { GameResponse as AnyResponse } from "../src/games.js";

/** A started game: always has a view. */
type GameResponse = AnyResponse & { view: PlayerView };

const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await s.app.close();
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function start(dbPath = ":memory:"): Server {
  const s = buildServer({ dbPath });
  servers.push(s);
  return s;
}

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "firetop-server-"));
  tempDirs.push(dir);
  return join(dir, "test.db");
}

interface Invite { playerId: string; name: string; url: string }

type SeatSpec = { name: string; archetype: string; bot?: boolean };

const HUMAN_AND_BOTS: SeatSpec[] = [
  { name: "Ann", archetype: "warrior" },
  { name: "Bot B", archetype: "survivor", bot: true },
  { name: "Bot C", archetype: "lucky", bot: true },
];
const TWO_HUMANS: SeatSpec[] = [
  { name: "Ann", archetype: "warrior" },
  { name: "Bo", archetype: "lucky" },
];

async function createGame(s: Server, seats: SeatSpec[], seed = 7): Promise<{ gameId: string; tokens: Record<string, string>; body: string }> {
  const res = await s.app.inject({ method: "POST", url: "/api/games", payload: { seed, seats } });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ gameId: string; invites: Invite[] }>();
  const tokens: Record<string, string> = {};
  for (const inv of body.invites) {
    expect(inv.url.startsWith(`/play/${body.gameId}#`)).toBe(true);
    tokens[inv.playerId] = inv.url.split("#")[1]!;
  }
  return { gameId: body.gameId, tokens, body: res.body };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function get(s: Server, gameId: string, token: string, query = "") {
  return s.app.inject({ method: "GET", url: `/api/games/${gameId}${query}`, headers: auth(token) });
}

async function post(s: Server, gameId: string, token: string, action: unknown, expectedSeq: number) {
  return s.app.inject({ method: "POST", url: `/api/games/${gameId}/actions`, headers: auth(token), payload: { action, expectedSeq } });
}

/** Asserts that a response body reveals nothing the viewer shouldn't see in `state`. */
function expectNoSecrets(body: string, state: GameState, viewerId: string) {
  expect(body).not.toContain("combination");
  expect(body).not.toContain("mazeTiles");
  expect(body).not.toContain('"rng"');
  expect(body).not.toContain('"seed"');
  expect(body).not.toContain('"loot"');
  const viewer = state.players.find((p) => p.id === viewerId)!;
  const view = (JSON.parse(body) as { view?: PlayerView }).view;
  for (const [id, room] of Object.entries(state.rooms)) {
    if (room.revealed) continue;
    if (view) expect(view.rooms[id]!.encounter).toBeUndefined();
    // Monster names are unique per game, so an unrevealed one must not appear anywhere.
    if (room.encounter.kind === "monster" && !viewer.peeks.includes(id)) expect(body).not.toContain(room.encounter.name);
  }
}

describe("creating games", () => {
  it("returns one invite per human seat and no secrets", async () => {
    const s = start();
    const { gameId, tokens, body } = await createGame(s, HUMAN_AND_BOTS);
    expect(Object.keys(tokens)).toEqual(["p1"]);
    expect(tokens.p1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body).not.toContain('"seed"');
    const state = s.store.load(gameId).state!;
    expectNoSecrets(body, state, "p1");
  });

  it("stores only token hashes", async () => {
    const s = start();
    const { gameId, tokens } = await createGame(s, TWO_HUMANS);
    const seats = s.db.getSeats(gameId);
    for (const seat of seats) {
      expect(seat.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.values(tokens)).not.toContain(seat.tokenHash);
    }
  });

  it("rejects bad setups", async () => {
    const s = start();
    const bad = [
      { seats: [{ name: "Solo", archetype: "warrior" }] },
      { seats: [{ name: "A", archetype: "wizard" }, { name: "B", archetype: "lucky" }] },
      { seats: [{ name: "A", archetype: "warrior", bot: true }, { name: "B", archetype: "lucky", bot: true }] },
      { seats: TWO_HUMANS, config: { keyCount: "lots" } },
      { seats: TWO_HUMANS, config: { roomMix: { monster: 5 } } },
      { seats: TWO_HUMANS, config: { roomMix: { monster: 1, treasure: 1, trap: 1, empty: 1 } } },
      { seats: TWO_HUMANS, config: { notARule: 1 } },
      { seats: TWO_HUMANS, seed: -1 },
      { seats: TWO_HUMANS, extra: true },
    ];
    for (const payload of bad) {
      const res = await s.app.inject({ method: "POST", url: "/api/games", payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("accepts rule overrides", async () => {
    const s = start();
    const res = await s.app.inject({
      method: "POST",
      url: "/api/games",
      payload: { seats: TWO_HUMANS, config: { restAmount: 3, wizard: { name: "Zagor", skill: 10, stamina: 14 } } },
    });
    expect(res.statusCode).toBe(201);
    const { gameId } = res.json<{ gameId: string }>();
    expect(s.store.load(gameId).state!.config.wizard.name).toBe("Zagor");
  });
});

describe("seat tokens", () => {
  it("rejects missing, malformed and wrong tokens", async () => {
    const s = start();
    const { gameId } = await createGame(s, TWO_HUMANS);
    const other = await createGame(s, TWO_HUMANS);
    expect((await s.app.inject({ method: "GET", url: `/api/games/${gameId}` })).statusCode).toBe(401);
    expect((await s.app.inject({ method: "GET", url: `/api/games/${gameId}`, headers: { authorization: "Basic abc" } })).statusCode).toBe(401);
    expect((await get(s, gameId, "x".repeat(43))).statusCode).toBe(401);
    // A real token, but for a different game.
    expect((await get(s, gameId, other.tokens.p1!)).statusCode).toBe(401);
    expect((await post(s, gameId, other.tokens.p1!, { type: "roll" }, 0)).statusCode).toBe(401);
    expect((await get(s, "nope", other.tokens.p1!)).statusCode).toBe(404);
  });

  it("each token sees only its own seat and can only act as it", async () => {
    const s = start();
    const { gameId, tokens } = await createGame(s, TWO_HUMANS);
    const a = (await get(s, gameId, tokens.p1!)).json<GameResponse>();
    const b = (await get(s, gameId, tokens.p2!)).json<GameResponse>();
    expect(a.playerId).toBe("p1");
    expect(a.view.viewerId).toBe("p1");
    expect(b.view.viewerId).toBe("p2");
    expect(a.view.currentPlayerId).toBe("p1");

    // p2 can't take p1's turn, and can't claim to be p1.
    const notYours = await post(s, gameId, tokens.p2!, { type: "roll" }, 0);
    expect(notYours.statusCode).toBe(400);
    expect(notYours.json<{ error: string }>().error).toBe("not your turn");
    const spoof = await s.app.inject({
      method: "POST",
      url: `/api/games/${gameId}/actions`,
      headers: auth(tokens.p2!),
      payload: { action: { type: "roll" }, expectedSeq: 0, actor: "p1" },
    });
    expect(spoof.statusCode).toBe(400);
    // Only the server may time a turn out.
    expect((await post(s, gameId, tokens.p2!, { type: "timeout" }, 0)).statusCode).toBe(400);

    const ok = await post(s, gameId, tokens.p1!, { type: "roll" }, 0);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<GameResponse>().seq).toBe(1);
    expect(s.db.getActions(gameId)).toEqual([{ seq: 1, actor: "p1", action: { type: "roll" } }]);

    // A player may change their own settings out of turn.
    const settings = await post(s, gameId, tokens.p2!, { type: "setSettings", settings: { fleeBelow: 2 } }, 1);
    expect(settings.statusCode).toBe(200);
    expect(settings.json<GameResponse>().view.me!.settings.fleeBelow).toBe(2);
  });
});

describe("actions", () => {
  it("rejects a stale expectedSeq with 409", async () => {
    const s = start();
    const { gameId, tokens } = await createGame(s, TWO_HUMANS);
    expect((await post(s, gameId, tokens.p1!, { type: "roll" }, 0)).statusCode).toBe(200);
    const stale = await post(s, gameId, tokens.p1!, { type: "rest" }, 0);
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ code: string }>().code).toBe("stale_seq");
    expect(s.db.getActions(gameId)).toHaveLength(1);
  });

  it("returns the engine's error for an illegal action and logs nothing", async () => {
    const s = start();
    const { gameId, tokens } = await createGame(s, TWO_HUMANS);
    const res = await post(s, gameId, tokens.p1!, { type: "move", to: "r1.0" }, 0);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe("rejected");
    expect(s.db.getActions(gameId)).toHaveLength(0);
  });

  it("rejects malformed actions", async () => {
    const s = start();
    const { gameId, tokens } = await createGame(s, TWO_HUMANS);
    for (const action of [{}, { type: "fly" }, { type: "move" }, { type: "move", to: "x", teleport: true }, { type: "orientTile", rotation: 9 }, "roll"]) {
      expect((await post(s, gameId, tokens.p1!, action, 0)).statusCode, JSON.stringify(action)).toBe(400);
    }
    const noSeq = await s.app.inject({ method: "POST", url: `/api/games/${gameId}/actions`, headers: auth(tokens.p1!), payload: { action: { type: "roll" } } });
    expect(noSeq.statusCode).toBe(400);
  });

  it("long-polls until something changes", async () => {
    const s = start();
    const { gameId, tokens } = await createGame(s, TWO_HUMANS);
    // Nothing new: returns after the wait with the same seq.
    const idle = (await get(s, gameId, tokens.p2!, "?since=0&wait=20")).json<GameResponse>();
    expect(idle.seq).toBe(0);
    // Already behind: returns at once.
    await post(s, gameId, tokens.p1!, { type: "roll" }, 0);
    expect((await get(s, gameId, tokens.p2!, "?since=0&wait=30000")).json<GameResponse>().seq).toBe(1);
    // Waiting: wakes up when p1 acts.
    const pending = get(s, gameId, tokens.p2!, "?since=1&wait=30000");
    await new Promise((r) => setTimeout(r, 20));
    const view = (await get(s, gameId, tokens.p1!)).json<GameResponse>().view;
    await post(s, gameId, tokens.p1!, botAction(view), 1);
    const woke = (await pending).json<GameResponse>();
    expect(woke.seq).toBeGreaterThan(1);
    expect(woke.view.viewerId).toBe("p2");
  });
});

/** Play a 1-human game over HTTP (the human plays the scripted bot's choices) until someone wins. */
async function playToEnd(s: Server, gameId: string, token: string, onResponse?: (body: string) => void) {
  let res = (await get(s, gameId, token)).json<GameResponse>();
  let requests = 0;
  while (res.view.phase !== "finished") {
    expect(res.view.currentPlayerId).toBe("p1"); // bots have played up to the human
    const r = await post(s, gameId, token, botAction(res.view) as Action, res.seq);
    expect(r.statusCode, r.body).toBe(200);
    onResponse?.(r.body);
    res = r.json<GameResponse>();
    if (++requests > 3000) throw new Error("game did not finish");
  }
  return res;
}

describe("a full game over HTTP", () => {
  it("plays to a win with bot seats, without leaking secrets", async () => {
    const s = start();
    const { gameId, tokens } = await createGame(s, HUMAN_AND_BOTS, 11);
    let checked = 0;
    const final = await playToEnd(s, gameId, tokens.p1!, (body) => {
      expectNoSecrets(body, s.store.load(gameId).state!, "p1");
      checked++;
    });
    expect(checked).toBeGreaterThan(5);
    expect(final.view.winner).not.toBeNull();
    expect(s.db.getGame(gameId)!.status).toBe("finished");
    const log = s.db.getActions(gameId);
    expect(log.length).toBe(final.seq);
    expect(log.some((a) => a.actor === "p2")).toBe(true);
    expect(log.some((a) => a.actor === "p3")).toBe(true);
    expect((await post(s, gameId, tokens.p1!, { type: "roll" }, final.seq)).statusCode).toBe(409); // game_over
  });

  it("bots move first when a bot holds the first seat", async () => {
    const s = start();
    const { gameId, tokens } = await createGame(s, [
      { name: "Bot A", archetype: "warrior", bot: true },
      { name: "Bo", archetype: "lucky" },
    ]);
    const res = (await get(s, gameId, tokens.p2!)).json<GameResponse>();
    expect(res.seq).toBeGreaterThan(0);
    expect(res.view.currentPlayerId).toBe("p2");
  });
});

describe("persistence", () => {
  it("a new server on the same file replays to the identical state", async () => {
    const path = tempDb();
    const s1 = start(path);
    const { gameId, tokens } = await createGame(s1, HUMAN_AND_BOTS, 5);
    let res = (await get(s1, gameId, tokens.p1!)).json<GameResponse>();
    for (let i = 0; i < 12 && res.view.phase !== "finished"; i++) {
      res = (await post(s1, gameId, tokens.p1!, botAction(res.view), res.seq)).json<GameResponse>();
    }
    const before = structuredClone(s1.store.load(gameId).state!);
    await s1.app.close();
    servers.splice(servers.indexOf(s1), 1);

    const s2 = start(path);
    const again = await get(s2, gameId, tokens.p1!);
    expect(again.statusCode).toBe(200);
    expect(again.json<GameResponse>()).toEqual(res);
    expect(s2.store.load(gameId).state!).toEqual(before);
    // And play continues from there.
    const next = await post(s2, gameId, tokens.p1!, botAction(res.view), res.seq);
    expect(next.statusCode).toBe(200);
  });

  it("refuses a game stored under other rules", async () => {
    const s = start();
    const { gameId, tokens } = await createGame(s, TWO_HUMANS);
    s.db.setRulesVersion(gameId, RULES_VERSION - 1);
    s.store.clearCache();
    const res = await get(s, gameId, tokens.p1!);
    expect(res.statusCode).toBe(410);
    expect(res.json<{ code: string; error: string }>()).toMatchObject({ code: "rules_version" });
    expect(res.json<{ error: string }>().error).toContain(`rules v${RULES_VERSION - 1}`);
    expect((await post(s, gameId, tokens.p1!, { type: "roll" }, 0)).statusCode).toBe(410);
  });
});
