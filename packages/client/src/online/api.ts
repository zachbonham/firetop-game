/**
 * Talks to the game server (packages/server). In dev, Vite proxies /api to
 * http://localhost:3000 (vite.config.ts); in production the server serves the
 * client from the same origin. Response types mirror packages/server/src/games.ts.
 */
import type { Action, Archetype, GameConfig, PlayerView } from "@firetop/engine";

export type GameStatus = "active" | "finished" | "abandoned";

export interface PublicSeat {
  playerId: string;
  name: string;
  archetype: Archetype;
  bot: boolean;
}

export interface GameResponse {
  gameId: string;
  seq: number;
  playerId: string;
  seats: PublicSeat[];
  status: GameStatus;
  turnSeconds: number;
  deadline: string | null;
  view: PlayerView;
}

export interface Invite {
  playerId: string;
  name: string;
  /** "/play/<gameId>#<token>" (or absolute if the server has PUBLIC_URL set). */
  url: string;
}

export interface CreatedGame {
  gameId: string;
  rulesVersion: number;
  invites: Invite[];
}

export interface NewGameRequest {
  seed?: number;
  config?: Partial<GameConfig>;
  turnSeconds?: number;
  seats: { name: string; archetype: Archetype; bot: boolean }[];
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
  /** With `since`, waits (long-poll) until the game moves past that seq or `waitMs` passes. */
  getGame: (gameId: string, token: string, opts: { since?: number; waitMs?: number; signal?: AbortSignal } = {}) => {
    const q = opts.since !== undefined ? `?since=${opts.since}&wait=${opts.waitMs ?? 25_000}` : "";
    return call<GameResponse>(`/api/games/${encodeURIComponent(gameId)}${q}`, { signal: opts.signal ?? null }, token);
  },
  act: (gameId: string, token: string, action: Action, expectedSeq: number) =>
    call<GameResponse>(`/api/games/${encodeURIComponent(gameId)}/actions`, { method: "POST", body: JSON.stringify({ action, expectedSeq }) }, token),
};
