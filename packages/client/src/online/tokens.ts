/**
 * Seat tokens for online games, kept in this browser's localStorage so a
 * player can come back to /play/<gameId> without the full invite link.
 * Invite links carry the token in the URL fragment (#...), which browsers
 * never send to the server.
 */
const KEY = "firetop.online.seats";

export interface StoredSeat {
  gameId: string;
  token: string;
  /** Display name for the "your games" list. */
  name?: string;
  savedAt: string;
}

function readAll(): Record<string, StoredSeat> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, StoredSeat>;
  } catch {
    return {};
  }
}

export function saveSeat(gameId: string, token: string, name?: string): void {
  const all = readAll();
  all[gameId] = { gameId, token, ...(name ? { name } : {}), savedAt: new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function seatFor(gameId: string): StoredSeat | null {
  return readAll()[gameId] ?? null;
}

export function forgetSeat(gameId: string): void {
  const all = readAll();
  delete all[gameId];
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function mySeats(): StoredSeat[] {
  return Object.values(readAll()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Parse "/play/<gameId>" plus an optional "#<token>" fragment. */
export function parsePlayUrl(pathname: string, hash: string): { gameId: string; token: string | null } | null {
  const m = /^\/play\/([A-Za-z0-9_-]{1,32})\/?$/.exec(pathname);
  if (!m) return null;
  const token = hash.replace(/^#/, "");
  return { gameId: m[1]!, token: /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null };
}

/** "in 23h 5m", "in 4m", "overdue". */
export function timeLeft(deadline: string, now: number): string {
  const ms = Date.parse(deadline) - now;
  if (ms <= 0) return "overdue";
  const m = Math.ceil(ms / 60_000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${mm}m`;
  return `in ${mm}m`;
}
