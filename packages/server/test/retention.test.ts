import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { RULES_VERSION } from "@firetop/engine";
import { buildServer, type Server } from "../src/app.js";
import { RETENTION_DAYS } from "../src/games.js";

/** Retention: games that can't change any more are deleted once they're past their window. */

const servers: Server[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.app.close();
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-15T12:00:00.000Z");

/** A server with a hand-moved clock; the sweeper and purger are off (tests call them). */
function start(dbPath = ":memory:") {
  const clock = { t: T0 };
  const s = buildServer({ dbPath, now: () => new Date(clock.t).toISOString(), sweepIntervalMs: 0, purgeIntervalMs: 0 });
  servers.push(s);
  return { s, clock };
}
function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "firetop-retention-"));
  tempDirs.push(dir);
  return join(dir, "test.db");
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const ANN = { name: "Ann", archetype: "warrior" };
const BOT = { name: "Cy", archetype: "survivor", bot: true };

async function create(s: Server, seats: unknown[]) {
  const res = await s.app.inject({ method: "POST", url: "/api/games", payload: { seed: 3, seats } });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ gameId: string; invites: { playerId: string; url: string }[] }>();
  const tokens = Object.fromEntries(body.invites.map((i) => [i.playerId, i.url.split("#")[1]!]));
  return { gameId: body.gameId, tokens };
}
const get = (s: Server, id: string, token: string) =>
  s.app.inject({ method: "GET", url: `/api/games/${id}`, headers: auth(token) });

/** One human who misses 3 turns: the game ends as abandoned. Returns when it ended. */
async function abandonedGame(s: Server, clock: { t: number }) {
  const g = await create(s, [ANN, BOT]);
  for (let i = 0; i < 3; i++) {
    clock.t += 25 * HOUR;
    s.store.sweep();
  }
  expect(s.db.getGame(g.gameId)!.status).toBe("abandoned");
  return { ...g, endedAt: clock.t };
}

describe("retention", () => {
  it("keeps an ended game for its window after it ends, then deletes it with its seats and log", async () => {
    const { s, clock } = start();
    const { gameId, tokens, endedAt } = await abandonedGame(s, clock);
    expect(s.db.getGame(gameId)!.updatedAt).toBe(new Date(endedAt).toISOString());

    clock.t = endedAt + RETENTION_DAYS.ended * DAY - 1000;
    expect(s.store.purge()).toBe(0);
    expect((await get(s, gameId, tokens.p1!)).statusCode).toBe(200);

    clock.t += 2000;
    expect(s.store.purge()).toBe(1);
    expect(s.db.getGame(gameId)).toBeUndefined();
    expect(s.db.getSeats(gameId)).toEqual([]);
    expect(s.db.getActions(gameId)).toEqual([]);
    const res = await get(s, gameId, tokens.p1!);
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toMatch(/deleted 30 days after/);
  });

  it("never deletes an active game, however long since it changed", async () => {
    const { s, clock } = start();
    const { gameId } = await create(s, [ANN, BOT]);
    clock.t += 1000 * DAY;
    expect(s.store.purge()).toBe(0);
    expect(s.db.getGame(gameId)!.status).toBe("active");
  });

  it("deletes a lobby nobody touched in its window; a claim restarts the count", async () => {
    const { s, clock } = start();
    const { gameId, tokens } = await create(s, [ANN, { open: true }, { open: true }]);
    clock.t += (RETENTION_DAYS.waiting - 1) * DAY;
    const r = await s.app.inject({
      method: "POST", url: `/api/games/${gameId}/claim`, headers: auth(tokens.p2!), payload: { name: "Bo", archetype: "lucky" },
    });
    expect(r.statusCode).toBe(200);
    expect(s.db.getGame(gameId)!.status).toBe("waiting");

    clock.t += 2 * DAY; // 15 days since creation, 2 since the claim
    expect(s.store.purge()).toBe(0);
    clock.t += RETENTION_DAYS.waiting * DAY;
    expect(s.store.purge()).toBe(1);
    expect(s.db.getGame(gameId)).toBeUndefined();
  });

  it("deletes games under other rules after their window, whatever their status, and the sweep skips them", async () => {
    const { s, clock } = start();
    const old = await create(s, [ANN, BOT]);
    const current = await create(s, [ANN, BOT]);
    s.db.setRulesVersion(old.gameId, RULES_VERSION - 1);
    s.store.clearCache();

    // Both are overdue; only the current one can be timed out.
    clock.t += 25 * HOUR;
    expect(s.store.sweep()).toBe(1);
    expect(s.db.getActions(current.gameId).length).toBeGreaterThan(0);

    clock.t = T0 + RETENTION_DAYS.otherRules * DAY + 1000;
    expect(s.store.purge()).toBe(1);
    expect(s.db.getGame(old.gameId)).toBeUndefined();
    expect(s.db.getGame(current.gameId)!.status).toBe("active");
  });

  it("deletes in batches until nothing is left past its window", async () => {
    const { s, clock } = start();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await abandonedGame(s, clock)).gameId);
    clock.t += (RETENTION_DAYS.ended + 1) * DAY;
    expect(s.store.purge()).toBe(3);
    expect(ids.map((id) => s.db.getGame(id))).toEqual([undefined, undefined, undefined]);
  });

  it("upgrades a database file from before retention: last change is the last action, else creation", async () => {
    const path = tempDb();
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, seed INTEGER NOT NULL, config TEXT NOT NULL,
      rules_version INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
      turn_seconds INTEGER NOT NULL DEFAULT 86400, deadline TEXT, lobby_rev INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE actions (game_id TEXT NOT NULL REFERENCES games(id), seq INTEGER NOT NULL, actor TEXT NOT NULL,
      action TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (game_id, seq));
      INSERT INTO games (id, seed, config, rules_version, status, created_at) VALUES
        ('played', 1, '{}', ${RULES_VERSION}, 'finished', '2026-01-01T00:00:00.000Z'),
        ('lobby', 1, '{}', ${RULES_VERSION}, 'waiting', '2026-02-01T00:00:00.000Z');
      INSERT INTO actions VALUES ('played', 1, 'p1', '{"type":"roll"}', '2026-01-05T00:00:00.000Z'),
        ('played', 2, 'p1', '{"type":"rest"}', '2026-01-09T00:00:00.000Z');`);
    old.close();
    const { s } = start(path);
    expect(s.db.getGame("played")!.updatedAt).toBe("2026-01-09T00:00:00.000Z");
    expect(s.db.getGame("lobby")!.updatedAt).toBe("2026-02-01T00:00:00.000Z");
  });
});
