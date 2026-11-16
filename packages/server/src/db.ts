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
  /**
   * waiting: some invited seats aren't claimed yet (no game state, no log yet).
   * finished: someone won. abandoned: no human players were left (bots never win alone).
   */
  status: "waiting" | "active" | "finished" | "abandoned";
  createdAt: string;
  /** Time a human has to finish their turn before the server times it out. */
  turnSeconds: number;
  /** When the current turn times out (ISO); null while waiting and once the game is over. */
  deadline: string | null;
  /** Bumped by every change that isn't an action: a seat claimed, the game started. */
  lobbyRev: number;
}

export interface SeatRow {
  playerId: string;
  name: string;
  archetype: Archetype;
  isBot: boolean;
  /** sha256(token) as hex; null for bot seats. */
  tokenHash: string | null;
  /**
   * open: invited, but its player hasn't picked a name and hero yet. claimed: in
   * the game (bots always are). dropped: still open when the game started.
   * Only claimed seats are players, in seat order.
   */
  status: "open" | "claimed" | "dropped";
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
  created_at    TEXT NOT NULL,
  turn_seconds  INTEGER NOT NULL DEFAULT 86400,
  deadline      TEXT,
  lobby_rev     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS seats (
  game_id    TEXT NOT NULL REFERENCES games(id),
  seat_index INTEGER NOT NULL,
  player_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  archetype  TEXT NOT NULL,
  is_bot     INTEGER NOT NULL,
  token_hash TEXT UNIQUE,
  seat_status TEXT NOT NULL DEFAULT 'claimed',
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
    this.migrate();
  }

  /** Add columns that newer versions introduced to an existing database file. */
  private migrate(): void {
    const cols = new Set(this.db.prepare("PRAGMA table_info(games)").all().map((r) => String(r.name)));
    if (!cols.has("turn_seconds")) this.db.exec("ALTER TABLE games ADD COLUMN turn_seconds INTEGER NOT NULL DEFAULT 86400");
    if (!cols.has("deadline")) this.db.exec("ALTER TABLE games ADD COLUMN deadline TEXT");
    if (!cols.has("lobby_rev")) this.db.exec("ALTER TABLE games ADD COLUMN lobby_rev INTEGER NOT NULL DEFAULT 0");
    const seatCols = new Set(this.db.prepare("PRAGMA table_info(seats)").all().map((r) => String(r.name)));
    if (!seatCols.has("seat_status")) this.db.exec("ALTER TABLE seats ADD COLUMN seat_status TEXT NOT NULL DEFAULT 'claimed'");
    this.db.exec("CREATE INDEX IF NOT EXISTS games_due ON games (status, deadline)");
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
        .prepare("INSERT INTO games (id, seed, config, rules_version, status, created_at, turn_seconds, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(game.id, game.seed, JSON.stringify(game.config), game.rulesVersion, game.status, game.createdAt, game.turnSeconds, game.deadline);
      const ins = this.db.prepare(
        "INSERT INTO seats (game_id, seat_index, player_id, name, archetype, is_bot, token_hash, seat_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      seats.forEach((s, i) => ins.run(game.id, i, s.playerId, s.name, s.archetype, s.isBot ? 1 : 0, s.tokenHash, s.status));
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
      turnSeconds: Number(r.turn_seconds),
      deadline: r.deadline === null ? null : String(r.deadline),
      lobbyRev: Number(r.lobby_rev),
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
        status: String(r.seat_status) as SeatRow["status"],
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

  /** Status and turn deadline after a commit (call inside `transaction`). */
  setTurn(gameId: string, status: GameRow["status"], deadline: string | null): void {
    this.db.prepare("UPDATE games SET status = ?, deadline = ? WHERE id = ?").run(status, deadline, gameId);
  }

  /** A player claims their invited seat, or changes their name or hero, while the game is waiting. */
  claimSeat(gameId: string, playerId: string, name: string, archetype: Archetype): void {
    this.transaction(() => {
      this.db
        .prepare("UPDATE seats SET name = ?, archetype = ?, seat_status = 'claimed' WHERE game_id = ? AND player_id = ?")
        .run(name, archetype, gameId, playerId);
      this.db.prepare("UPDATE games SET lobby_rev = lobby_rev + 1 WHERE id = ?").run(gameId);
    });
  }

  /** Start a waiting game: seats still open are dropped and the turn clock starts. */
  startGame(gameId: string, deadline: string): void {
    this.transaction(() => {
      this.db.prepare("UPDATE seats SET seat_status = 'dropped' WHERE game_id = ? AND seat_status = 'open'").run(gameId);
      this.db.prepare("UPDATE games SET status = 'active', deadline = ?, lobby_rev = lobby_rev + 1 WHERE id = ?").run(deadline, gameId);
    });
  }

  /** Active games whose turn deadline is at or before `now` (ISO strings compare in time order). */
  dueGames(now: string, limit = 100): string[] {
    return this.db
      .prepare("SELECT id FROM games WHERE status = 'active' AND deadline IS NOT NULL AND deadline <= ? ORDER BY deadline LIMIT ?")
      .all(now, limit)
      .map((r) => String(r.id));
  }

  /** Tests only: pretend a game was stored under other rules. */
  setRulesVersion(gameId: string, version: number): void {
    this.db.prepare("UPDATE games SET rules_version = ? WHERE id = ?").run(version, gameId);
  }
}
