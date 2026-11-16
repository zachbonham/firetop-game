/**
 * Talks to the game server (packages/server). In dev, Vite proxies /api to
 * http://localhost:3000 (vite.config.ts); in production the server serves the
 * client from the same origin. Response types mirror packages/server/src/games.ts.
 */
import type { Action, Archetype, GameConfig, PlayerView } from "@firetop/engine";

export type GameStatus = "waiting" | "active" | "finished" | "abandoned";

export interface PublicSeat {
  playerId: string;
  /** "" for an open seat. */
  name: string;
  /** null for an open seat. */
  archetype: Archetype | null;
  bot: boolean;
  /** Invited, but its player hasn't joined yet. */
  open: boolean;
}

export interface GameResponse {
  gameId: string;
  seq: number;
  /** Goes up with every change, including seats claimed before the game starts. */
  rev: number;
  playerId: string;
  /** This seat created the game and may start it early. */
  host: boolean;
  seats: PublicSeat[];
  status: GameStatus;
  turnSeconds: number;
  deadline: string | null;
  /** null while the game is waiting for players. */
  view: PlayerView | null;
}

/** A game that has started (status isn't "waiting"). */
export type StartedGame = GameResponse & { view: PlayerView };

export interface Invite {
  playerId: string;
  /** "" for an open seat. */
  name: string;
  /** The player picks their own name and hero from the link. */
  open: boolean;
  /** "/play/<gameId>#<token>" (or absolute if the server has PUBLIC_URL set). */
  url: string;
}

export interface CreatedGame {
  gameId: string;
  status: GameStatus;
  rulesVersion: number;
  invites: Invite[];
}

export interface NewGameRequest {
  seed?: number;
  config?: Partial<GameConfig>;
  turnSeconds?: number;
  /** A bot or a person with a name and hero, or an open seat for an invited player. */
  seats: ({ name: string; archetype: Archetype; bot: boolean } | { open: true })[];
}

/** An error the server answered with ({error, code}), or a network failure (status 0). */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "can't reach the game server", "network");
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON (e.g. a proxy error page)
  }
  if (!res.ok) {
    const b = body as { error?: string; code?: string } | null;
    throw new ApiError(res.status, b?.error ?? `server error ${res.status}`, b?.code ?? "http");
  }
  return body as T;
}

export const api = {
  createGame: (req: NewGameRequest) => call<CreatedGame>("/api/games", { method: "POST", body: JSON.stringify(req) }),
  /** With `rev`, waits (long-poll) until the game changes past that rev or `waitMs` passes. */
  getGame: (gameId: string, token: string, opts: { rev?: number; waitMs?: number; signal?: AbortSignal } = {}) => {
    const q = opts.rev !== undefined ? `?rev=${opts.rev}&wait=${opts.waitMs ?? 25_000}` : "";
    return call<GameResponse>(`/api/games/${encodeURIComponent(gameId)}${q}`, { signal: opts.signal ?? null }, token);
  },
  act: (gameId: string, token: string, action: Action, expectedSeq: number) =>
    call<GameResponse>(`/api/games/${encodeURIComponent(gameId)}/actions`, { method: "POST", body: JSON.stringify({ action, expectedSeq }) }, token),
  /** Take your invited seat (or change your name or hero) before the game starts. */
  claim: (gameId: string, token: string, name: string, archetype: Archetype) =>
    call<GameResponse>(`/api/games/${encodeURIComponent(gameId)}/claim`, { method: "POST", body: JSON.stringify({ name, archetype }) }, token),
  /** The creator starts the game with whoever has joined. */
  start: (gameId: string, token: string) =>
    call<GameResponse>(`/api/games/${encodeURIComponent(gameId)}/start`, { method: "POST" }, token),
};
