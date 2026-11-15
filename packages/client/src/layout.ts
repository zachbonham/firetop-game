import { BOARD, CONNECTIONS, MAZE_SIZE, ROOM_IDS, ROOM_SIZES, type LocationId, type NodeId } from "@firetop/engine";

/**
 * Placeholder board geometry for the local test board. Locations sit on a
 * grid by depth (entrance on the left, lair on the right); room squares run
 * left-to-right; path squares are spaced evenly between the rooms they join.
 * M5 replaces this with real board art.
 */

export interface Point {
  x: number;
  y: number;
}

const COL = 175;
const ROW = 92;
const MARGIN = 50;
export const SQUARE_GAP = 26;
export const TILE = 46;

/** [column, row] for each location. */
const GRID: Record<Exclude<LocationId, "lair">, [number, number]> = {
  entrance: [0, 2.5],
  r1: [1, 1.5],
  r2: [1, 3.5],
  r3: [2, 0.5],
  r4: [2, 2.5],
  r5: [2, 4.5],
  r6: [3, 1.5],
  r7: [3, 3],
  r8: [3, 4.8],
  r9: [4, 1.8],
  r10: [4, 4],
  maze: [5, 2.5],
};

function center(loc: Exclude<LocationId, "lair">): Point {
  const [c, r] = GRID[loc];
  return { x: MARGIN + c * COL, y: MARGIN + r * ROW };
}

const mazeCenter = center("maze");
/** Top-left corner of the 4x4 maze grid. */
export const MAZE_ORIGIN: Point = {
  x: mazeCenter.x + 55,
  y: mazeCenter.y - (MAZE_SIZE * TILE) / 2,
};

export function tileCenter(row: number, col: number): Point {
  return { x: MAZE_ORIGIN.x + col * TILE + TILE / 2, y: MAZE_ORIGIN.y + row * TILE + TILE / 2 };
}

export const LAIR_POS: Point = { x: MAZE_ORIGIN.x + MAZE_SIZE * TILE + 70, y: mazeCenter.y };

export const WIDTH = LAIR_POS.x + 70;
export const HEIGHT = MARGIN * 2 + 4.8 * ROW + 20;

function buildPositions(): Map<NodeId, Point> {
  const pos = new Map<NodeId, Point>();
  pos.set("entrance", center("entrance"));
  pos.set("maze", mazeCenter);
  pos.set("lair", LAIR_POS);
  for (const room of ROOM_IDS) {
    const c = center(room);
    const n = ROOM_SIZES[room];
    for (let i = 0; i < n; i++) pos.set(`${room}.${i}`, { x: c.x + (i - (n - 1) / 2) * SQUARE_GAP, y: c.y });
  }
  const far = (loc: LocationId): NodeId =>
    loc.startsWith("r") ? `${loc}.${ROOM_SIZES[loc as (typeof ROOM_IDS)[number]] - 1}` : loc;
  const near = (loc: LocationId): NodeId => (loc.startsWith("r") ? `${loc}.0` : loc);
  for (const [from, to, len] of CONNECTIONS) {
    const a = pos.get(far(from))!;
    const b = pos.get(near(to))!;
    for (let i = 0; i < len; i++) {
      const t = (i + 1) / (len + 1);
      pos.set(`p:${from}-${to}.${i}`, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  for (const id of Object.keys(BOARD.squares)) {
    if (!pos.has(id)) throw new Error(`layout is missing square ${id}`);
  }
  return pos;
}

export const POSITIONS = buildPositions();

/** Position of any node, including maze tiles ("m:r:c"). */
export function positionOf(id: NodeId): Point | undefined {
  if (id.startsWith("m:")) {
    const [, r, c] = id.split(":");
    return tileCenter(Number(r), Number(c));
  }
  return POSITIONS.get(id);
}

/** Every board edge once, for drawing. */
export const EDGES: [NodeId, NodeId][] = (() => {
  const out: [NodeId, NodeId][] = [];
  for (const sq of Object.values(BOARD.squares)) {
    for (const n of sq.neighbors) if (sq.id < n) out.push([sq.id, n]);
  }
  return out;
})();

export const ROOM_LABEL_POS: Record<string, Point> = Object.fromEntries(
  ROOM_IDS.map((r) => [r, center(r)]),
);
