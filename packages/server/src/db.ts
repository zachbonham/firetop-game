import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Action, Actor, Archetype, GameConfig } from "@firetop/engine";

/**
 * One SQLite file (node:sqlite, built into Node 22: no native build step).
 * Only the setup and the action log are stored; game state is rebuilt by
 * replaying the log through the engine.
 */

export interface GameRow {
  id: string;
  seed: number;
  config: Partial<GameConfig>;
  rulesVersion: number;
  status: "active" | "finished";
  createdAt: string;
}

export interface SeatRow {
  playerId: string;
  name: string;
  archetype: Archetype;
  isBot: boolean;
  /** sha256(token) as hex; null for bot seats. */
  tokenHash: string | null;
}

export interface ActionRow {
  seq: number;
  actor: Actor;
  action: Action;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,
  seed          INTEGER NOT NULL,
  config        TEXT NOT NULL,
  rules_version INTEGER NOT NULL,
  status        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seats (
  game_id    TEXT NOT NULL REFERENCES games(id),
  seat_index INTEGER NOT NULL,
  player_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  archetype  TEXT NOT NULL,
  is_bot     INTEGER NOT NULL,
  token_hash TEXT UNIQUE,
  PRIMARY KEY (game_id, player_id)
);
CREATE TABLE IF NOT EXISTS actions (
  game_id    TEXT NOT NULL REFERENCES games(id),
  seq        INTEGER NOT NULL,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (game_id, seq)
);
`;

export class Db {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /** Run `fn` in a transaction; rolls back if it throws. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  insertGame(game: GameRow, seats: SeatRow[]): void {
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO games (id, seed, config, rules_version, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(game.id, game.seed, JSON.stringify(game.config), game.rulesVersion, game.status, game.createdAt);
      const ins = this.db.prepare(
        "INSERT INTO seats (game_id, seat_index, player_id, name, archetype, is_bot, token_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      seats.forEach((s, i) => ins.run(game.id, i, s.playerId, s.name, s.archetype, s.isBot ? 1 : 0, s.tokenHash));
    });
  }

  getGame(id: string): GameRow | undefined {
    const r = this.db.prepare("SELECT * FROM games WHERE id = ?").get(id);
    if (!r) return undefined;
    return {
      id: String(r.id),
      seed: Number(r.seed),
      config: JSON.parse(String(r.config)) as Partial<GameConfig>,
      rulesVersion: Number(r.rules_version),
      status: String(r.status) as GameRow["status"],
      createdAt: String(r.created_at),
    };
  }

  getSeats(gameId: string): SeatRow[] {
    return this.db
      .prepare("SELECT * FROM seats WHERE game_id = ? ORDER BY seat_index")
      .all(gameId)
      .map((r) => ({
        playerId: String(r.player_id),
        name: String(r.name),
        archetype: String(r.archetype) as Archetype,
        isBot: Number(r.is_bot) === 1,
        tokenHash: r.token_hash === null ? null : String(r.token_hash),
      }));
  }

  getActions(gameId: string): ActionRow[] {
    return this.db
      .prepare("SELECT seq, actor, action FROM actions WHERE game_id = ? ORDER BY seq")
      .all(gameId)
      .map((r) => ({ seq: Number(r.seq), actor: String(r.actor), action: JSON.parse(String(r.action)) as Action }));
  }

  /** Append actions (call inside `transaction`). The (game_id, seq) key rejects a duplicate seq. */
  appendActions(gameId: string, rows: readonly ActionRow[], now: string): void {
    const ins = this.db.prepare("INSERT INTO actions (game_id, seq, actor, action, created_at) VALUES (?, ?, ?, ?, ?)");
    for (const r of rows) ins.run(gameId, r.seq, r.actor, JSON.stringify(r.action), now);
  }

  setStatus(gameId: string, status: GameRow["status"]): void {
    this.db.prepare("UPDATE games SET status = ? WHERE id = ?").run(status, gameId);
  }

  /** Tests only: pretend a game was stored under other rules. */
  setRulesVersion(gameId: string, version: number): void {
    this.db.prepare("UPDATE games SET rules_version = ? WHERE id = ?").run(version, gameId);
  }
}
