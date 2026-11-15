import type { LocationId, NodeId } from "./types.js";

/**
 * The fixed board: 14 locations joined by paths of squares.
 *
 *   entrance -> rooms r1..r10 (optional) -> maze (4x4 tile grid) -> lair
 *
 * The camp sits on r4's routes to r6 and r7. It has no encounter; once a
 * player has entered it, defeats wake them there instead of at the entrance.
 *
 * Paths attach to the "near" end of a room (square 0) when coming from the
 * entrance side, and leave from the "far" end, so crossing a room means
 * walking through its squares. The maze grid itself lives in maze.ts; the
 * board only has the "maze" square in front of it and the "lair" behind it.
 */

export interface Square {
  id: NodeId;
  /** null for path squares between locations. */
  location: LocationId | null;
  neighbors: NodeId[];
}

export interface Board {
  squares: Record<NodeId, Square>;
  rooms: LocationId[];
}

export const ROOM_IDS = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"] as const;

/** Squares inside each room (assumed 1-3). */
export const ROOM_SIZES: Record<(typeof ROOM_IDS)[number], number> = {
  r1: 2, r2: 1, r3: 3, r4: 2, r5: 2, r6: 1, r7: 3, r8: 2, r9: 2, r10: 1,
};

/** [from (entrance side), to (maze side), path length in squares]. */
export const CONNECTIONS: ReadonlyArray<readonly [LocationId, LocationId, number]> = [
  ["entrance", "r1", 2],
  ["entrance", "r2", 3],
  ["r1", "r3", 2],
  ["r1", "r4", 3],
  ["r2", "r4", 2],
  ["r2", "r5", 3],
  ["r3", "r6", 3],
  ["r4", "camp", 1],
  ["camp", "r6", 1],
  ["camp", "r7", 1],
  ["r5", "r7", 2],
  ["r5", "r8", 3],
  ["r6", "r9", 2],
  ["r7", "r9", 3],
  ["r7", "r10", 2],
  ["r8", "r10", 2],
  ["r9", "maze", 3],
  ["r10", "maze", 3],
];

export const ENTRANCE: NodeId = "entrance";
export const CAMP: NodeId = "camp";
export const MAZE_SQUARE: NodeId = "maze";
export const LAIR: NodeId = "lair";

function roomSquares(room: (typeof ROOM_IDS)[number]): NodeId[] {
  return Array.from({ length: ROOM_SIZES[room] }, (_, i) => `${room}.${i}`);
}

/** Single-square locations (everything except the rooms). */
function isPoint(loc: LocationId): boolean {
  return loc === "entrance" || loc === "camp" || loc === "maze" || loc === "lair";
}

function nearEnd(loc: LocationId): NodeId {
  if (isPoint(loc)) return loc;
  return `${loc}.0`;
}

function farEnd(loc: LocationId): NodeId {
  if (isPoint(loc)) return loc;
  return `${loc}.${ROOM_SIZES[loc as (typeof ROOM_IDS)[number]] - 1}`;
}

function buildBoard(): Board {
  const squares: Record<NodeId, Square> = {};
  const add = (id: NodeId, location: LocationId | null) => {
    squares[id] = { id, location, neighbors: [] };
  };
  const link = (a: NodeId, b: NodeId) => {
    squares[a]!.neighbors.push(b);
    squares[b]!.neighbors.push(a);
  };

  add(ENTRANCE, "entrance");
  add(CAMP, "camp");
  add(MAZE_SQUARE, "maze");
  add(LAIR, "lair");
  for (const room of ROOM_IDS) {
    const ids = roomSquares(room);
    ids.forEach((id) => add(id, room));
    for (let i = 1; i < ids.length; i++) link(ids[i - 1]!, ids[i]!);
  }
  for (const [from, to, len] of CONNECTIONS) {
    let prev = farEnd(from);
    for (let i = 0; i < len; i++) {
      const id = `p:${from}-${to}.${i}`;
      add(id, null);
      link(prev, id);
      prev = id;
    }
    link(prev, nearEnd(to));
  }
  return { squares, rooms: [...ROOM_IDS] };
}

export const BOARD: Board = buildBoard();

export function isMazeTile(id: NodeId): boolean {
  return id.startsWith("m:");
}

/** Location of any node; maze tiles belong to the "maze" location. */
export function locationOf(id: NodeId): LocationId | null {
  if (isMazeTile(id)) return "maze";
  return BOARD.squares[id]?.location ?? null;
}

/** Shortest distances over board squares only (ignores the maze grid). */
export function boardDistances(from: NodeId): Map<NodeId, number> {
  const dist = new Map<NodeId, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of BOARD.squares[cur]?.neighbors ?? []) {
      if (!dist.has(n)) {
        dist.set(n, dist.get(cur)! + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}
