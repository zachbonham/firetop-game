import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  RULES_VERSION, applyAction, botAction, checkInvariants, createGame, playerView,
  type Action, type Archetype, type GameConfig, type GameState, type PlayerView,
} from "@firetop/engine";
import { checkConfig } from "./config-check.js";
import type { ActionRow, Db, GameRow, SeatRow } from "./db.js";

/** An error with the HTTP status the API should answer with. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message);
  }
}

export interface NewSeat {
  name: string;
  archetype: Archetype;
  bot: boolean;
}

export interface NewGameInput {
  seed?: number;
  config?: Partial<GameConfig>;
  seats: NewSeat[];
}

export interface CreatedGame {
  gameId: string;
  /** One secret token per human seat (never stored: only its sha256 is). */
  tokens: { playerId: string; name: string; token: string }[];
}

/** A game as held in memory: its stored setup plus the state rebuilt from the log. */
export interface LiveGame {
  row: GameRow;
  seats: SeatRow[];
  state: GameState;
  /** Number of actions in the log (0 = nothing played yet). */
  seq: number;
}

export interface PublicSeat {
  playerId: string;
  name: string;
  archetype: Archetype;
  bot: boolean;
}

/** Everything a client gets about a game: always built from playerView. */
export interface GameResponse {
  gameId: string;
  seq: number;
  playerId: string;
  seats: PublicSeat[];
  view: PlayerView;
}

export interface StoreOptions {
  /** Most bot actions played in one go before giving the turn back (safety cap). */
  maxBotActions?: number;
  /** Most games kept in the replay cache. */
  cacheSize?: number;
  now?: () => string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class GameStore {
  private readonly cache = new Map<string, LiveGame>();
  private readonly changes = new EventEmitter();
  private readonly maxBotActions: number;
  private readonly cacheSize: number;
  private readonly now: () => string;

  constructor(private readonly db: Db, opts: StoreOptions = {}) {
    this.maxBotActions = opts.maxBotActions ?? 5000;
    this.cacheSize = opts.cacheSize ?? 200;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.changes.setMaxListeners(0);
  }

  create(input: NewGameInput): CreatedGame {
    if (!input.seats.some((s) => !s.bot)) throw new ApiError(400, "a game needs at least one human seat", "bad_request");
    const configError = input.config === undefined ? null : checkConfig(input.config);
    if (configError) throw new ApiError(400, configError, "bad_config");

    const seed = input.seed ?? randomInt(0, 2 ** 32);
    const config = input.config ?? {};
    const seats: SeatRow[] = [];
    const tokens: CreatedGame["tokens"] = [];
    input.seats.forEach((s, i) => {
      const playerId = `p${i + 1}`;
      let tokenHash: string | null = null;
      if (!s.bot) {
        const token = randomBytes(32).toString("base64url");
        tokenHash = hashToken(token);
        tokens.push({ playerId, name: s.name, token });
      }
      seats.push({ playerId, name: s.name, archetype: s.archetype, isBot: s.bot, tokenHash });
    });

    let state: GameState;
    try {
      state = createGame({ seed, config, players: seats.map((s) => ({ id: s.playerId, name: s.name, archetype: s.archetype })) });
    } catch (e) {
      throw new ApiError(400, `cannot set up this game: ${e instanceof Error ? e.message : String(e)}`, "bad_config");
    }
    const broken = checkInvariants(state);
    if (broken.length) throw new ApiError(400, `cannot set up this game: ${broken.join("; ")}`, "bad_config");

    const row: GameRow = { id: randomBytes(9).toString("base64url"), seed, config, rulesVersion: RULES_VERSION, status: "active", createdAt: this.now() };
    this.db.insertGame(row, seats);
    const game: LiveGame = { row, seats, state, seq: 0 };
    this.remember(game);
    this.advanceBots(game);
    return { gameId: row.id, tokens };
  }

  /** Load a game, rebuilding its state from the log (cached). */
  load(gameId: string): LiveGame {
    const cached = this.cache.get(gameId);
    if (cached) {
      this.remember(cached);
      return cached;
    }
    const row = this.db.getGame(gameId);
    if (!row) throw new ApiError(404, "no such game", "not_found");
    if (row.rulesVersion !== RULES_VERSION) {
      throw new ApiError(
        410,
        `this game was played under rules v${row.rulesVersion}; this server runs rules v${RULES_VERSION} and won't replay it`,
        "rules_version",
      );
    }
    const seats = this.db.getSeats(gameId);
    let state = createGame({
      seed: row.seed,
      config: row.config,
      players: seats.map((s) => ({ id: s.playerId, name: s.name, archetype: s.archetype })),
    });
    const actions = this.db.getActions(gameId);
    actions.forEach((a, i) => {
      if (a.seq !== i + 1) throw new ApiError(500, `game ${gameId}: action log has a gap at seq ${i + 1}`, "corrupt");
      const r = applyAction(state, a.actor, a.action);
      if (!r.ok) throw new ApiError(500, `game ${gameId}: logged action ${a.seq} no longer applies: ${r.error}`, "corrupt");
      state = r.state;
    });
    const game: LiveGame = { row, seats, state, seq: actions.length };
    this.remember(game);
    // A bot left on move (the safety cap was hit) gets to play now.
    this.advanceBots(game);
    return game;
  }

  /** The seat a bearer token belongs to in this game, or a 401. */
  authenticate(gameId: string, token: string | undefined): { game: LiveGame; seat: SeatRow } {
    if (!token) throw new ApiError(401, "missing seat token", "unauthorized");
    const game = this.load(gameId);
    const hash = Buffer.from(hashToken(token), "hex");
    const seat = game.seats.find((s) => s.tokenHash !== null && timingSafeEqual(Buffer.from(s.tokenHash, "hex"), hash));
    if (!seat) throw new ApiError(401, "this token is not a seat in this game", "unauthorized");
    return { game, seat };
  }

  /**
   * Apply `action` for `playerId` (from the token, never from the client), then
   * let bot seats play until a human is up. Everything is written to the log in
   * one transaction.
   */
  act(gameId: string, playerId: string, action: Action, expectedSeq: number): LiveGame {
    const game = this.load(gameId);
    if (expectedSeq !== game.seq) {
      throw new ApiError(409, `the game has moved on (seq ${game.seq}, you sent ${expectedSeq}); reload and try again`, "stale_seq");
    }
    const r = applyAction(game.state, playerId, action);
    if (!r.ok) throw new ApiError(400, r.error, "rejected");
    const rows: ActionRow[] = [{ seq: game.seq + 1, actor: playerId, action }];
    const bots = this.playBots(game.seats, r.state, game.seq + 1);
    rows.push(...bots.rows);
    this.commit(game, rows, bots.state);
    return game;
  }

  response(game: LiveGame, playerId: string): GameResponse {
    return {
      gameId: game.row.id,
      seq: game.seq,
      playerId,
      seats: game.seats.map((s) => ({ playerId: s.playerId, name: s.name, archetype: s.archetype, bot: s.isBot })),
      view: playerView(game.state, playerId),
    };
  }

  /** Resolve once the game's seq passes `since`, or after `ms` (or on `signal` abort). */
  waitForChange(gameId: string, since: number, ms: number, signal?: AbortSignal): Promise<void> {
    if (this.load(gameId).seq > since) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.changes.off(gameId, onChange);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const onChange = (seq: number) => {
        if (seq > since) done();
      };
      const timer = setTimeout(done, ms);
      this.changes.on(gameId, onChange);
      signal?.addEventListener("abort", done);
    });
  }

  /** Drop the replay cache (tests; a new process starts empty anyway). */
  clearCache(): void {
    this.cache.clear();
  }

  private advanceBots(game: LiveGame): void {
    const bots = this.playBots(game.seats, game.state, game.seq);
    if (bots.rows.length) this.commit(game, bots.rows, bots.state);
  }

  /** Play bot seats from `state` until a human is up, the game ends, or the cap is hit. Pure. */
  private playBots(seats: SeatRow[], state: GameState, seq: number): { rows: ActionRow[]; state: GameState } {
    const botIds = new Set(seats.filter((s) => s.isBot).map((s) => s.playerId));
    const rows: ActionRow[] = [];
    while (state.phase !== "finished" && rows.length < this.maxBotActions) {
      const id = state.players[state.currentIndex]!.id;
      if (!botIds.has(id)) break;
      const action = botAction(playerView(state, id));
      const r = applyAction(state, id, action);
      if (!r.ok) {
        // Shouldn't happen; skip the bot's turn rather than wedge the game.
        const t = applyAction(state, "system", { type: "timeout" });
        if (!t.ok) break;
        rows.push({ seq: seq + rows.length + 1, actor: "system", action: { type: "timeout" } });
        state = t.state;
        continue;
      }
      rows.push({ seq: seq + rows.length + 1, actor: id, action });
      state = r.state;
    }
    return { rows, state };
  }

  private commit(game: LiveGame, rows: ActionRow[], state: GameState): void {
    const finished = state.phase === "finished";
    this.db.transaction(() => {
      this.db.appendActions(game.row.id, rows, this.now());
      if (finished && game.row.status !== "finished") this.db.setStatus(game.row.id, "finished");
    });
    game.state = state;
    game.seq += rows.length;
    if (finished) game.row.status = "finished";
    this.changes.emit(game.row.id, game.seq);
  }

  private remember(game: LiveGame): void {
    this.cache.delete(game.row.id);
    this.cache.set(game.row.id, game);
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}


