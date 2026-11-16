import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer, type Server } from "../src/app.js";
import type { GameResponse, PublicLogResponse } from "../src/games.js";

/** Open seats: invited players pick their own name and hero, and the creator can start early. */

const servers: Server[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.app.close();
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function start(dbPath = ":memory:"): Server {
  const s = buildServer({ dbPath, sweepIntervalMs: 0 });
  servers.push(s);
  return s;
}
function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "firetop-seats-"));
  tempDirs.push(dir);
  return join(dir, "test.db");
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const HOST = { name: "Ann", archetype: "warrior" };
const OPEN = { open: true };

async function create(s: Server, seats: unknown[]) {
  const res = await s.app.inject({ method: "POST", url: "/api/games", payload: { seed: 11, seats } });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ gameId: string; status: string; invites: { playerId: string; name: string; open: boolean; url: string }[] }>();
  const tokens: Record<string, string> = {};
  for (const inv of body.invites) tokens[inv.playerId] = inv.url.split("#")[1]!;
  return { ...body, tokens };
}
const get = (s: Server, id: string, token: string, query = "") =>
  s.app.inject({ method: "GET", url: `/api/games/${id}${query}`, headers: auth(token) });
const claim = (s: Server, id: string, token: string, name: string, archetype: string) =>
  s.app.inject({ method: "POST", url: `/api/games/${id}/claim`, headers: auth(token), payload: { name, archetype } });
const begin = (s: Server, id: string, token: string) =>
  s.app.inject({ method: "POST", url: `/api/games/${id}/start`, headers: auth(token) });

describe("open seats", () => {
  it("waits for players: no state, no clock, no actions yet", async () => {
    const s = start();
    const g = await create(s, [HOST, OPEN, { name: "Bot", archetype: "lucky", bot: true }]);
    expect(g.status).toBe("waiting");
    expect(g.invites.map((i) => [i.playerId, i.open])).toEqual([["p1", false], ["p2", true]]);

    const host = (await get(s, g.gameId, g.tokens.p1!)).json<GameResponse>();
    expect(host).toMatchObject({ status: "waiting", host: true, deadline: null, view: null, seq: 0 });
    expect(host.seats).toEqual([
      { playerId: "p1", name: "Ann", archetype: "warrior", bot: false, open: false },
      { playerId: "p2", name: "", archetype: null, bot: false, open: true },
      { playerId: "p3", name: "Bot", archetype: "lucky", bot: true, open: false },
    ]);
    expect((await get(s, g.gameId, g.tokens.p2!)).json<GameResponse>().host).toBe(false);

    const act = await s.app.inject({
      method: "POST", url: `/api/games/${g.gameId}/actions`, headers: auth(g.tokens.p1!), payload: { action: { type: "roll" }, expectedSeq: 0 },
    });
    expect(act.statusCode).toBe(409);
    expect(act.json().code).toBe("not_started");
  });

  it("an invited player picks their own name and hero; the last claim starts the game", async () => {
    const s = start();
    const g = await create(s, [HOST, OPEN, OPEN]);
    const r0 = (await get(s, g.gameId, g.tokens.p1!)).json<GameResponse>().rev;

    // The host's waiting room long-polls on rev and wakes for a claim.
    const pending = get(s, g.gameId, g.tokens.p1!, `?rev=${r0}&wait=30000`);
    const c = await claim(s, g.gameId, g.tokens.p2!, "  Bo ", "survivor");
    expect(c.statusCode).toBe(200);
    const woke = (await pending).json<GameResponse>();
    expect(woke.rev).toBeGreaterThan(r0);
    expect(woke.seats[1]).toEqual({ playerId: "p2", name: "Bo", archetype: "survivor", bot: false, open: false });
    expect(woke.status).toBe("waiting");

    // Changing your mind before the start is fine.
    await claim(s, g.gameId, g.tokens.p2!, "Bo", "lucky");
    const last = (await claim(s, g.gameId, g.tokens.p3!, "Cy", "warrior")).json<GameResponse>();
    expect(last.status).toBe("active");
    expect(last.deadline).not.toBeNull();
    expect(last.view!.players.map((p) => [p.id, p.name, p.archetype])).toEqual([
      ["p1", "Ann", "warrior"], ["p2", "Bo", "lucky"], ["p3", "Cy", "warrior"],
    ]);

    const late = await claim(s, g.gameId, g.tokens.p2!, "Bob", "lucky");
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe("started");
  });

  it("the creator can start early; seats nobody claimed are dropped", async () => {
    const s = start();
    const g = await create(s, [HOST, OPEN, OPEN, OPEN]);

    // Alone, the host can't start: a game needs 2 players.
    const alone = await begin(s, g.gameId, g.tokens.p1!);
    expect(alone.statusCode).toBe(409);
    expect(alone.json().code).toBe("too_few");

    await claim(s, g.gameId, g.tokens.p3!, "Cy", "survivor");
    const notHost = await begin(s, g.gameId, g.tokens.p3!);
    expect(notHost.statusCode).toBe(403);
    expect(notHost.json().code).toBe("not_host");

    const started = (await begin(s, g.gameId, g.tokens.p1!)).json<GameResponse>();
    expect(started.status).toBe("active");
    expect(started.seats.map((x) => x.playerId)).toEqual(["p1", "p3"]);
    expect(started.view!.players.map((p) => p.name)).toEqual(["Ann", "Cy"]);
    expect(started.view!.log[0]!.text).toContain("2 players");

    // A link nobody used in time: a clear "gone", not a bad token.
    const dropped = await get(s, g.gameId, g.tokens.p2!);
    expect(dropped.statusCode).toBe(410);
    expect(dropped.json().code).toBe("seat_dropped");
    expect((await begin(s, g.gameId, g.tokens.p1!)).json().code).toBe("started");

    const log = (await s.app.inject({ method: "GET", url: `/api/games/${g.gameId}/log` })).json<PublicLogResponse>();
    expect(log.seats.map((x) => [x.playerId, x.status])).toEqual([["p1", "active"], ["p3", "active"]]);
  });

  it("bots in the game count toward starting, and move at once if they go first", async () => {
    const s = start();
    const g = await create(s, [{ name: "Bot", archetype: "lucky", bot: true }, HOST, OPEN]);
    const started = (await begin(s, g.gameId, g.tokens.p2!)).json<GameResponse>();
    expect(started.status).toBe("active");
    expect(started.view!.players.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(started.seq).toBeGreaterThan(0);
    expect(started.view!.currentPlayerId).toBe("p2");
  });

  it("a waiting game and an early-started one survive a restart", async () => {
    const path = tempDb();
    const s1 = start(path);
    const waiting = await create(s1, [HOST, OPEN]);
    const early = await create(s1, [HOST, OPEN, OPEN]);
    await claim(s1, early.gameId, early.tokens.p3!, "Cy", "lucky");
    const before = (await begin(s1, early.gameId, early.tokens.p1!)).json<GameResponse>();
    await s1.app.close();
    servers.splice(servers.indexOf(s1), 1);

    const s2 = start(path);
    const w = (await get(s2, waiting.gameId, waiting.tokens.p1!)).json<GameResponse>();
    expect(w).toMatchObject({ status: "waiting", view: null });
    expect((await claim(s2, waiting.gameId, waiting.tokens.p2!, "Bo", "warrior")).json<GameResponse>().status).toBe("active");
    expect((await get(s2, early.gameId, early.tokens.p1!)).json<GameResponse>()).toEqual(before);
    expect((await get(s2, early.gameId, early.tokens.p2!)).statusCode).toBe(410);
  });

  it("rejects bad setups and claims", async () => {
    const s = start();
    const firstOpen = await s.app.inject({ method: "POST", url: "/api/games", payload: { seats: [OPEN, HOST] } });
    expect(firstOpen.statusCode).toBe(400);
    const mixed = await s.app.inject({ method: "POST", url: "/api/games", payload: { seats: [HOST, { open: true, name: "x" }] } });
    expect(mixed.statusCode).toBe(400);

    const g = await create(s, [HOST, OPEN]);
    expect((await claim(s, g.gameId, g.tokens.p2!, "Bo", "wizard")).statusCode).toBe(400);
    expect((await claim(s, g.gameId, g.tokens.p2!, "   ", "lucky")).statusCode).toBe(400);
    expect((await claim(s, g.gameId, "not-a-token", "Bo", "lucky")).statusCode).toBe(401);
  });

  it("upgrades a database file from before open seats", async () => {
    const path = tempDb();
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, seed INTEGER NOT NULL, config TEXT NOT NULL,
      rules_version INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
      turn_seconds INTEGER NOT NULL DEFAULT 86400, deadline TEXT);
      CREATE TABLE seats (game_id TEXT NOT NULL REFERENCES games(id), seat_index INTEGER NOT NULL,
      player_id TEXT NOT NULL, name TEXT NOT NULL, archetype TEXT NOT NULL, is_bot INTEGER NOT NULL,
      token_hash TEXT UNIQUE, PRIMARY KEY (game_id, player_id));`);
    old.close();
    const s = start(path);
    const g = await create(s, [HOST, OPEN]);
    expect((await claim(s, g.gameId, g.tokens.p2!, "Bo", "lucky")).json<GameResponse>().status).toBe("active");
  });
});
