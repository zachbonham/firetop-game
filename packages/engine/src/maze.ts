import { MAZE_DEAL } from "./config.js";
import type { Rng } from "./rng.js";
import type { NodeId, TileType } from "./types.js";

/**
 * 4x4 maze of face-down tiles. Each player has a private view: the tiles they
 * have flipped and the rotation they chose. Rotation is free, so any tile can
 * be entered from any side; dead ends and badly turned tiles are what slow
 * you down.
 *
 * Players enter from the "maze" board square into tile (ENTRY_ROW, 0) through
 * its west side, and leave through the east side of any column-3 tile into
 * the lair.
 */

export const MAZE_SIZE = 4;
export const ENTRY_ROW = 1;

export const N = 1, E = 2, S = 4, W = 8;
export const DIRS = [N, E, S, W] as const;

const BASE: Record<TileType, number> = {
  straight: N | S,
  corner: N | E,
  tee: N | E | S,
  cross: N | E | S | W,
  dead: N,
};

export function rotate(mask: number, rotation: number): number {
  let m = mask;
  for (let i = 0; i < ((rotation % 4) + 4) % 4; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
}

export function openings(type: TileType, rotation: number): number {
  return rotate(BASE[type], rotation);
}

export function opposite(dir: number): number {
  return rotate(dir, 2);
}

export function step(r: number, c: number, dir: number): [number, number] {
  if (dir === N) return [r - 1, c];
  if (dir === S) return [r + 1, c];
  if (dir === E) return [r, c + 1];
  return [r, c - 1];
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && c >= 0 && r < MAZE_SIZE && c < MAZE_SIZE;
}

export function tileId(r: number, c: number): NodeId {
  return `m:${r}:${c}`;
}

export function tileKey(r: number, c: number): string {
  return `${r}:${c}`;
}

export function parseTile(id: NodeId): [number, number] {
  const [, r, c] = id.split(":");
  return [Number(r), Number(c)];
}

export function tileAt(tiles: readonly TileType[], r: number, c: number): TileType {
  return tiles[r * MAZE_SIZE + c] as TileType;
}

/**
 * Revealed tiles ("r:c" keys) a player can walk to from the maze square through
 * their own turned tiles: every step needs both tiles open toward each other.
 * `open(r, c)` is a tile's openings as the player turned it, or undefined if
 * they haven't revealed it.
 */
export function reachableFromEntry(open: (r: number, c: number) => number | undefined): Set<string> {
  const seen = new Set<string>();
  const entry = open(ENTRY_ROW, 0);
  if (entry === undefined || !(entry & W)) return seen;
  const queue: [number, number][] = [[ENTRY_ROW, 0]];
  seen.add(tileKey(ENTRY_ROW, 0));
  while (queue.length) {
    const [r, c] = queue.shift()!;
    const o = open(r, c)!;
    for (const dir of DIRS) {
      if (!(o & dir)) continue;
      const [nr, nc] = step(r, c, dir);
      const key = tileKey(nr, nc);
      if (!inBounds(nr, nc) || seen.has(key)) continue;
      const no = open(nr, nc);
      if (no === undefined || !(no & opposite(dir))) continue;
      seen.add(key);
      queue.push([nr, nc]);
    }
  }
  return seen;
}

/** reachableFromEntry for a player's maze record ("r:c" -> rotation). */
export function reachableInMaze(tiles: readonly TileType[], maze: Record<string, number>): Set<string> {
  return reachableFromEntry((r, c) => {
    const rot = maze[tileKey(r, c)];
    return rot === undefined ? undefined : openings(tileAt(tiles, r, c), rot);
  });
}

/** Can this tile type connect entry side `a` to exit side `b` under some rotation? */
export function canConnect(type: TileType, a: number, b: number): boolean {
  for (let rot = 0; rot < 4; rot++) {
    const o = openings(type, rot);
    if ((o & a) && (o & b)) return true;
  }
  return false;
}

/**
 * True if a route exists from the entry (west of ENTRY_ROW,0) to the east edge,
 * where each tile on the route can be turned to join its entry and exit sides.
 */
export function isSolvable(tiles: readonly TileType[]): boolean {
  type St = { r: number; c: number; from: number };
  const seen = new Set<string>();
  const queue: St[] = [{ r: ENTRY_ROW, c: 0, from: W }];
  while (queue.length) {
    const { r, c, from } = queue.shift()!;
    const key = `${r}:${c}:${from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const type = tileAt(tiles, r, c);
    for (const out of DIRS) {
      if (out === from || !canConnect(type, from, out)) continue;
      if (c === MAZE_SIZE - 1 && out === E) return true;
      const [nr, nc] = step(r, c, out);
      if (inBounds(nr, nc)) queue.push({ r: nr, c: nc, from: opposite(out) });
    }
  }
  return false;
}

export function dealMaze(rng: Rng): TileType[] {
  const deck: TileType[] = [];
  for (const [type, count] of Object.entries(MAZE_DEAL) as [TileType, number][]) {
    for (let i = 0; i < count; i++) deck.push(type);
  }
  if (deck.length !== MAZE_SIZE * MAZE_SIZE) throw new Error("maze deal must have 16 tiles");
  for (let attempt = 0; attempt < 1000; attempt++) {
    const tiles = rng.shuffle(deck);
    if (isSolvable(tiles)) return tiles;
  }
  throw new Error("could not deal a solvable maze");
}
