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

/** Turn lengths a game can be created with: 1 hour, 12 hours, 24 hours, 3 days. */
export const TURN_LENGTHS = [3600, 43_200, 86_400, 259_200] as const;
export const DEFAULT_TURN_SECONDS = 86_400;

/**
 * A seat in a new game: a bot or a person with a name and hero, or an open
 * seat whose player picks their own name and hero from the invite link.
 */
export type NewSeat = { name: string; archetype: Archetype; bot?: boolean } | { open: true };

export interface NewGameInput {
  seed?: number;
  config?: Partial<GameConfig>;
  seats: NewSeat[];
  /** One of TURN_LENGTHS; default 24 hours. */
  turnSeconds?: number;
}

export interface CreatedGame {
  gameId: string;
  status: GameRow["status"];
  /** One secret token per human seat (never stored: only its sha256 is). */
  tokens: { playerId: string; name: string; open: boolean; token: string }[];
}

/** A game as held in memory: its stored setup plus the state rebuilt from the log. */
export interface LiveGame {
  row: GameRow;
  seats: SeatRow[];
  /** null while the game is waiting for players. */
  state: GameState | null;
  /** Number of actions in the log (0 = nothing played yet). */
  seq: number;
}

export interface PublicSeat {
  playerId: string;
  /** "" for an open seat. */
  name: string;
  /** null for an open seat. */
  archetype: Archetype | null;
  bot: boolean;
  /** Still waiting for its player to claim it. */
  open: boolean;
}

/** Everything a client gets about a game: always built from playerView. */
export interface GameResponse {
  gameId: string;
  seq: number;
  /** Goes up with every change to the game, including seats claimed before it starts (long-poll with `rev`). */
  rev: number;
  playerId: string;
  /** This seat created the game, so it may start it before every seat is claimed. */
  host: boolean;
  /** While waiting, every seat (open ones too); once started, only the players. */
  seats: PublicSeat[];
  /** waiting (for players), active, finished (someone won) or abandoned (no human players left). */
  status: GameRow["status"];
  turnSeconds: number;
  /** When the current turn times out (ISO), or null while waiting and once the game is over. */
  deadline: string | null;
  /** null while the game is waiting for players. */
  view: PlayerView | null;
}

/** What anyone with the game id may see: the public log, no seat token needed. */
export interface PublicLogResponse {
  gameId: string;
  seq: number;
  status: GameRow["status"];
  turn: number;
  turnSeconds: number;
  deadline: string | null;
  seats: (Omit<PublicSeat, "open"> & { status: "open" | "joined" | "active" | "removed" })[];
  winner: string | null;
  log: PlayerView["log"];
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

/** The players of a game, in turn order: its claimed seats. */
function lineup(seats: SeatRow[]): SeatRow[] {
  return seats.filter((s) => s.status === "claimed");
}

function setupFor(row: GameRow, players: SeatRow[]) {
  return { seed: row.seed, config: row.config, players: players.map((s) => ({ id: s.playerId, name: s.name, archetype: s.archetype })) };
}

/** The seat that created the game: the first human seat (never an open one). */
function hostOf(seats: SeatRow[]): SeatRow | undefined {
  return seats.find((s) => !s.isBot);
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
    const isOpen = (s: NewSeat): s is { open: true } => "open" in s;
    if (!input.seats.some((s) => isOpen(s) || !s.bot)) throw new ApiError(400, "a game needs at least one human seat", "bad_request");
    const firstHuman = input.seats.find((s) => isOpen(s) || !s.bot);
    if (firstHuman && isOpen(firstHuman)) {
      throw new ApiError(400, "the first human seat is the creator's own: give it a name and hero", "bad_request");
    }
    const turnSeconds = input.turnSeconds ?? DEFAULT_TURN_SECONDS;
    if (!(TURN_LENGTHS as readonly number[]).includes(turnSeconds)) {
      throw new ApiError(400, `turnSeconds must be one of ${TURN_LENGTHS.join(", ")}`, "bad_request");
    }
    const configError = input.config === undefined ? null : checkConfig(input.config);
    if (configError) throw new ApiError(400, configError, "bad_config");

    const seed = input.seed ?? randomInt(0, 2 ** 32);
    const config = input.config ?? {};
    const seats: SeatRow[] = [];
    const tokens: CreatedGame["tokens"] = [];
    input.seats.forEach((s, i) => {
      const playerId = `p${i + 1}`;
      const open = isOpen(s);
      const bot = !open && !!s.bot;
      let tokenHash: string | null = null;
      if (!bot) {
        const token = randomBytes(32).toString("base64url");
        tokenHash = hashToken(token);
        tokens.push({ playerId, name: open ? "" : s.name, open, token });
      }
      // An open seat's name and hero are placeholders until its player claims it.
      seats.push({
        playerId, name: open ? "" : s.name, archetype: open ? "warrior" : s.archetype, isBot: bot, tokenHash,
        status: open ? "open" : "claimed",
      });
    });
    const waiting = seats.some((s) => s.status === "open");

    // Check the setup now, as if every seat were filled, so a bad config fails here and not at start.
    const createdAt = this.now();
    const row: GameRow = {
      id: randomBytes(9).toString("base64url"), seed, config, rulesVersion: RULES_VERSION,
      status: waiting ? "waiting" : "active", createdAt, turnSeconds,
      deadline: waiting ? null : this.deadlineFrom(createdAt, turnSeconds), lobbyRev: 0,
    };
    const state = this.setUp(row, waiting ? seats : lineup(seats));

    this.db.insertGame(row, seats);
    const game: LiveGame = { row, seats, state: waiting ? null : state, seq: 0 };
    this.remember(game);
    if (!waiting) this.advanceBots(game);
    return { gameId: row.id, status: row.status, tokens };
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
    if (row.status === "waiting") {
      const game: LiveGame = { row, seats, state: null, seq: 0 };
      this.remember(game);
      return game;
    }
    let state = createGame(setupFor(row, lineup(seats)));
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
    if (row.status === "active") this.advanceBots(game);
    return game;
  }

  /** The seat a bearer token belongs to in this game, or a 401. */
  authenticate(gameId: string, token: string | undefined): { game: LiveGame; seat: SeatRow } {
    if (!token) throw new ApiError(401, "missing seat token", "unauthorized");
    const game = this.load(gameId);
    const hash = Buffer.from(hashToken(token), "hex");
    const seat = game.seats.find((s) => s.tokenHash !== null && timingSafeEqual(Buffer.from(s.tokenHash, "hex"), hash));
    if (!seat) throw new ApiError(401, "this token is not a seat in this game", "unauthorized");
    if (seat.status === "dropped") {
      throw new ApiError(410, "this game started before this seat was claimed, so it went ahead without it", "seat_dropped");
    }
    return { game, seat };
  }

  /**
   * A player claims their invited seat (or changes their name or hero) while the
   * game is waiting. Once every invited seat is claimed, the game starts.
   */
  claim(gameId: string, playerId: string, name: string, archetype: Archetype): LiveGame {
    const game = this.load(gameId);
    if (game.row.status !== "waiting") throw new ApiError(409, "this game has already started", "started");
    const seat = game.seats.find((s) => s.playerId === playerId);
    if (!seat || seat.isBot) throw new ApiError(400, "not a seat you can claim", "bad_request");
    this.db.claimSeat(gameId, playerId, name, archetype);
    seat.name = name;
    seat.archetype = archetype;
    seat.status = "claimed";
    game.row.lobbyRev++;
    if (!game.seats.some((s) => s.status === "open")) this.begin(game);
    else this.changed(game);
    return game;
  }

  /** The creator starts a waiting game with the seats claimed so far; open seats are dropped. */
  start(gameId: string, playerId: string): LiveGame {
    const game = this.load(gameId);
    if (game.row.status !== "waiting") throw new ApiError(409, "this game has already started", "started");
    if (hostOf(game.seats)?.playerId !== playerId) {
      throw new ApiError(403, "only the player who created the game can start it", "not_host");
    }
    if (lineup(game.seats).length < 2) {
      throw new ApiError(409, "a game needs at least 2 players: wait for someone to join", "too_few");
    }
    this.begin(game);
    return game;
  }

  /**
   * Apply `action` for `playerId` (from the token, never from the client), then
   * let bot seats play until a human is up. Everything is written to the log in
   * one transaction.
   */
  act(gameId: string, playerId: string, action: Action, expectedSeq: number): LiveGame {
    const game = this.load(gameId);
    if (game.row.status === "waiting") throw new ApiError(409, "this game hasn't started yet", "not_started");
    if (game.row.status !== "active" || !game.state) throw new ApiError(409, `this game is ${game.row.status}`, "game_over");
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
    const seats = game.state ? lineup(game.seats) : game.seats.filter((s) => s.status !== "dropped");
    return {
      gameId: game.row.id,
      seq: game.seq,
      rev: rev(game),
      playerId,
      host: hostOf(game.seats)?.playerId === playerId,
      seats: seats.map(publicSeat),
      status: game.row.status,
      turnSeconds: game.row.turnSeconds,
      deadline: game.row.deadline,
      view: game.state ? playerView(game.state, playerId) : null,
    };
  }

  /** The public log and seat list, for spectators (no secrets, no private log entries). */
  publicLog(gameId: string): PublicLogResponse {
    const game = this.load(gameId);
    const state = game.state;
    if (!state) {
      return {
        gameId: game.row.id, seq: 0, status: game.row.status, turn: 0, turnSeconds: game.row.turnSeconds, deadline: null,
        seats: game.seats.map((s) => {
          const { open, ...seat } = publicSeat(s);
          return { ...seat, status: open ? "open" : "joined" };
        }),
        winner: null, log: [],
      };
    }
    const view = playerView(state, null);
    return {
      gameId: game.row.id,
      seq: game.seq,
      status: game.row.status,
      turn: state.turn,
      turnSeconds: game.row.turnSeconds,
      deadline: game.row.deadline,
      seats: lineup(game.seats).map((s) => {
        const { open: _open, ...seat } = publicSeat(s);
        return { ...seat, status: state.players.find((p) => p.id === s.playerId)!.status };
      }),
      winner: game.row.status === "finished" ? state.winner : null,
      log: view.log,
    };
  }

  /**
   * Time out every human whose turn deadline has passed (the server calls this
   * every minute). Each overdue game gets one system timeout, then its bots
   * play, through the same commit path as a player's action. Returns how many
   * turns were timed out.
   */
  sweep(): number {
    const now = this.now();
    let n = 0;
    for (const id of this.db.dueGames(now)) {
      let game: LiveGame;
      try {
        game = this.load(id);
      } catch {
        continue; // e.g. stored under other rules: leave it alone
      }
      if (game.row.status !== "active" || !game.state || game.row.deadline === null || game.row.deadline > now) continue;
      const r = applyAction(game.state, "system", { type: "timeout" });
      if (!r.ok) continue;
      const rows: ActionRow[] = [{ seq: game.seq + 1, actor: "system", action: { type: "timeout" } }];
      const bots = this.playBots(game.seats, r.state, game.seq + 1);
      rows.push(...bots.rows);
      this.commit(game, rows, bots.state);
      n++;
    }
    return n;
  }

  /**
   * Resolve once the game moves past `since`, or after `ms` (or on `signal` abort).
   * `by` says what `since` counts: "seq" (actions only) or "rev" (any change,
   * including seats claimed while the game waits for players).
   */
  waitForChange(gameId: string, since: number, ms: number, signal?: AbortSignal, by: "seq" | "rev" = "seq"): Promise<void> {
    const at = (g: LiveGame) => (by === "rev" ? rev(g) : g.seq);
    if (at(this.load(gameId)) > since) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.changes.off(gameId, onChange);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const onChange = (g: LiveGame) => {
        if (at(g) > since) done();
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

  /** Set up the engine state for these players, or a 400 if this game can't be set up. */
  private setUp(row: GameRow, players: SeatRow[]): GameState {
    let state: GameState;
    try {
      state = createGame(setupFor(row, players));
    } catch (e) {
      throw new ApiError(400, `cannot set up this game: ${e instanceof Error ? e.message : String(e)}`, "bad_config");
    }
    const broken = checkInvariants(state);
    if (broken.length) throw new ApiError(400, `cannot set up this game: ${broken.join("; ")}`, "bad_config");
    return state;
  }

  /** Start a waiting game with its claimed seats; the rest are dropped. */
  private begin(game: LiveGame): void {
    const state = this.setUp(game.row, lineup(game.seats));
    for (const s of game.seats) if (s.status === "open") s.status = "dropped";
    const deadline = this.deadlineFrom(this.now(), game.row.turnSeconds);
    this.db.startGame(game.row.id, deadline);
    game.row.status = "active";
    game.row.deadline = deadline;
    game.row.lobbyRev++;
    game.state = state;
    this.changed(game);
    this.advanceBots(game);
  }

  private advanceBots(game: LiveGame): void {
    if (!game.state) return;
    const bots = this.playBots(game.seats, game.state, game.seq);
    if (bots.rows.length) this.commit(game, bots.rows, bots.state);
  }

  /** Play bot seats from `state` until a human is up, the game ends, or the cap is hit. Pure. */
  private playBots(seats: SeatRow[], state: GameState, seq: number): { rows: ActionRow[]; state: GameState } {
    const botIds = new Set(seats.filter((s) => s.isBot).map((s) => s.playerId));
    const rows: ActionRow[] = [];
    while (state.phase !== "finished" && rows.length < this.maxBotActions && humansLeft(seats, state)) {
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
    const now = this.now();
    // No humans left means the game is over, whatever the engine says: bots never win on their own.
    const status: GameRow["status"] = !humansLeft(game.seats, state) ? "abandoned" : state.phase === "finished" ? "finished" : "active";
    // The clock restarts only when the turn passes, not for every action within it
    // (or another player changing their settings).
    const deadline = status !== "active"
      ? null
      : state.turn !== game.state?.turn || game.row.deadline === null
        ? this.deadlineFrom(now, game.row.turnSeconds)
        : game.row.deadline;
    this.db.transaction(() => {
      this.db.appendActions(game.row.id, rows, now);
      this.db.setTurn(game.row.id, status, deadline);
    });
    game.state = state;
    game.seq += rows.length;
    game.row.status = status;
    game.row.deadline = deadline;
    this.changed(game);
  }

  private changed(game: LiveGame): void {
    this.changes.emit(game.row.id, game);
  }

  private deadlineFrom(iso: string, seconds: number): string {
    return new Date(Date.parse(iso) + seconds * 1000).toISOString();
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

/** Every change to a game moves this up: actions, plus claims and the start. */
function rev(game: LiveGame): number {
  return game.seq + game.row.lobbyRev;
}

function publicSeat(s: SeatRow): PublicSeat {
  const open = s.status === "open";
  return { playerId: s.playerId, name: s.name, archetype: open ? null : s.archetype, bot: s.isBot, open };
}

/** Is any human seat still in the game? */
function humansLeft(seats: SeatRow[], state: GameState): boolean {
  return seats.some((s) => !s.isBot && state.players.find((p) => p.id === s.playerId)?.status === "active");
}
