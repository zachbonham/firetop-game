import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer, type Server } from "../src/app.js";
import type { GameResponse, PublicLogResponse } from "../src/games.js";

const servers: Server[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.app.close();
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const HOUR = 3600_000;
const T0 = Date.parse("2026-11-15T12:00:00.000Z");

/** A server with a clock the test moves by hand and the sweeper off (tests call sweep()). */
function start(dbPath = ":memory:") {
  const clock = { t: T0 };
  const s = buildServer({ dbPath, now: () => new Date(clock.t).toISOString(), sweepIntervalMs: 0 });
  servers.push(s);
  return { s, clock };
}

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "firetop-timer-"));
  tempDirs.push(dir);
  return join(dir, "test.db");
}

type Seat = { name: string; archetype: string; bot?: boolean };
const TWO_HUMANS_AND_BOT: Seat[] = [
  { name: "Ann", archetype: "warrior" },
  { name: "Bo", archetype: "lucky" },
  { name: "Cy", archetype: "survivor", bot: true },
];
const ONE_HUMAN: Seat[] = [
  { name: "Ann", archetype: "warrior" },
  { name: "Cy", archetype: "survivor", bot: true },
];

async function create(s: Server, seats: Seat[], extra: Record<string, unknown> = {}) {
  const res = await s.app.inject({ method: "POST", url: "/api/games", payload: { seed: 3, seats, ...extra } });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ gameId: string; invites: { playerId: string; url: string }[] }>();
  const tokens = Object.fromEntries(body.invites.map((i) => [i.playerId, i.url.split("#")[1]!]));
  return { gameId: body.gameId, tokens };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function get(s: Server, gameId: string, token: string) {
  const res = await s.app.inject({ method: "GET", url: `/api/games/${gameId}`, headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json<GameResponse>();
}
async function act(s: Server, gameId: string, token: string, action: unknown, expectedSeq: number) {
  return s.app.inject({ method: "POST", url: `/api/games/${gameId}/actions`, headers: auth(token), payload: { action, expectedSeq } });
}
async function publicLog(s: Server, gameId: string) {
  const res = await s.app.inject({ method: "GET", url: `/api/games/${gameId}/log` });
  expect(res.statusCode).toBe(200);
  return res.json<PublicLogResponse>();
}

describe("turn timer", () => {
  it("defaults to 24 hours, and a game can pick 1h, 12h or 3 days", async () => {
    const { s } = start();
    const a = await create(s, ONE_HUMAN);
    const ga = await get(s, a.gameId, a.tokens.p1!);
    expect(ga.turnSeconds).toBe(86_400);
    expect(ga.deadline).toBe(new Date(T0 + 24 * HOUR).toISOString());
    expect(ga.status).toBe("active");

    const b = await create(s, ONE_HUMAN, { turnSeconds: 3600 });
    expect((await get(s, b.gameId, b.tokens.p1!)).deadline).toBe(new Date(T0 + HOUR).toISOString());

    const bad = await s.app.inject({ method: "POST", url: "/api/games", payload: { seats: ONE_HUMAN, turnSeconds: 999 } });
    expect(bad.statusCode).toBe(400);
  });

  it("restarts the clock when the turn passes, not for every action in it", async () => {
    const { s, clock } = start();
    const { gameId, tokens } = await create(s, TWO_HUMANS_AND_BOT);
    const first = (await get(s, gameId, tokens.p1!)).deadline;

    clock.t += HOUR;
    // Bo changes a setting out of turn: Ann's clock doesn't move.
    let r = await act(s, gameId, tokens.p2!, { type: "setSettings", settings: { autoLuck: false } }, 0);
    expect(r.statusCode).toBe(200);
    expect(r.json<GameResponse>().deadline).toBe(first);

    // Ann rolls (same turn): still the same deadline.
    r = await act(s, gameId, tokens.p1!, { type: "roll" }, 1);
    const afterRoll = r.json<GameResponse>();
    if (afterRoll.view.currentPlayerId === "p1") {
      expect(afterRoll.deadline).toBe(first);
      // Ann rests next turn instead... finish the turn by moving to the first option.
      const to = afterRoll.view.me!.moveOptions[0]!.to;
      r = await act(s, gameId, tokens.p1!, { type: "move", to }, afterRoll.seq);
    }
    const next = r.json<GameResponse>();
    if (next.view.currentPlayerId !== "p1") expect(next.deadline).toBe(new Date(clock.t + 24 * HOUR).toISOString());
  });

  it("times out an overdue turn, in the public log, and starts the next player's clock", async () => {
    const { s, clock } = start();
    const { gameId, tokens } = await create(s, TWO_HUMANS_AND_BOT);
    clock.t += 24 * HOUR - 1000;
    expect(s.store.sweep()).toBe(0);

    clock.t += 2000;
    expect(s.store.sweep()).toBe(1);
    const bo = await get(s, gameId, tokens.p2!);
    expect(bo.seq).toBe(1);
    expect(bo.view.currentPlayerId).toBe("p2");
    expect(bo.deadline).toBe(new Date(clock.t + 24 * HOUR).toISOString());
    expect(bo.view.log.some((e) => e.type === "timeout" && e.text.includes("Ann"))).toBe(true);
    const pub = await publicLog(s, gameId);
    expect(pub.log.some((e) => e.type === "timeout" && e.text.includes("Ann ran out of time"))).toBe(true);
    expect(s.store.sweep()).toBe(0); // nothing else due yet
  });

  it("a game with humans left carries on after one is removed", async () => {
    const { s, clock } = start();
    const { gameId, tokens } = await create(s, TWO_HUMANS_AND_BOT);
    // Bo plays every turn; Ann never does and is removed after 3 missed turns.
    for (let i = 0; i < 20; i++) {
      const g = await get(s, gameId, tokens.p2!);
      if (g.view.players[0]!.status === "removed") break;
      if (g.view.currentPlayerId === "p2") {
        const r = await act(s, gameId, tokens.p2!, { type: "rest" }, g.seq);
        expect(r.statusCode).toBe(200);
      } else {
        clock.t += 25 * HOUR;
        s.store.sweep();
      }
    }
    const g = await get(s, gameId, tokens.p2!);
    expect(g.view.players[0]!.status).toBe("removed");
    expect(g.status).toBe("active");
    expect(g.deadline).not.toBeNull();
  });

  it("ends the game as abandoned when no humans are left; bots don't win", async () => {
    const { s, clock } = start();
    const { gameId, tokens } = await create(s, ONE_HUMAN);
    for (let i = 0; i < 3; i++) {
      clock.t += 25 * HOUR;
      expect(s.store.sweep()).toBe(1);
    }
    const g = await get(s, gameId, tokens.p1!);
    expect(g.status).toBe("abandoned");
    expect(g.deadline).toBeNull();
    const pub = await publicLog(s, gameId);
    expect(pub.status).toBe("abandoned");
    expect(pub.winner).toBeNull();
    expect(pub.seats.find((x) => x.playerId === "p1")!.status).toBe("removed");

    const r = await act(s, gameId, tokens.p1!, { type: "roll" }, g.seq);
    expect(r.statusCode).toBe(409);
    expect(r.json<{ code: string }>().code).toBe("game_over");
    clock.t += 100 * HOUR;
    expect(s.store.sweep()).toBe(0);
  });

  it("keeps deadlines across a restart", async () => {
    const path = tempDb();
    const a = start(path);
    const { gameId, tokens } = await create(a.s, ONE_HUMAN);
    const before = await get(a.s, gameId, tokens.p1!);
    await a.s.app.close();
    servers.splice(servers.indexOf(a.s), 1);

    const b = start(path);
    expect((await get(b.s, gameId, tokens.p1!)).deadline).toBe(before.deadline);
    b.clock.t += 25 * HOUR;
    expect(b.s.store.sweep()).toBe(1);
  });

  it("upgrades a database file from before the timer", async () => {
    const path = tempDb();
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, seed INTEGER NOT NULL, config TEXT NOT NULL,
      rules_version INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);`);
    old.close();
    const { s } = start(path);
    const { gameId, tokens } = await create(s, ONE_HUMAN);
    expect((await get(s, gameId, tokens.p1!)).turnSeconds).toBe(86_400);
  });
});

describe("public game log", () => {
  it("needs no token and shows no secrets or private entries", async () => {
    const { s } = start();
    const { gameId } = await create(s, TWO_HUMANS_AND_BOT);
    const res = await s.app.inject({ method: "GET", url: `/api/games/${gameId}/log` });
    expect(res.statusCode).toBe(200);
    const body = res.json<PublicLogResponse>();
    expect(body.seats.map((x) => x.name)).toEqual(["Ann", "Bo", "Cy"]);
    expect(body.log.every((e) => e.privateTo === undefined)).toBe(true);
    expect(res.body).not.toMatch(/combination|token|rng/i);
    const missing = await s.app.inject({ method: "GET", url: `/api/games/nope/log` });
    expect(missing.statusCode).toBe(404);
  });
});
