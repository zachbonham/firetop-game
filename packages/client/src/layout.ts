import { BOARD, CONNECTIONS, MAZE_SIZE, ROOM_IDS, ROOM_SIZES, type LocationId, type NodeId } from "@firetop/engine";

/**
 * Board geometry. Two layouts share one builder:
 *  - LANDSCAPE (desktop): locations on a grid by depth, entrance on the left,
 *    maze and lair on the right.
 *  - PORTRAIT (phones): the same graph climbing the mountain, entrance at the
 *    bottom, then the maze, with the lair at the top. It fits a phone's width
 *    and scrolls vertically. The maze is drawn turned a quarter (its way in at
 *    the bottom, its exits at the top) so the whole board reads bottom to top.
 * In both, room squares run left-to-right and path squares are spaced evenly
 * between the rooms they join. Board.tsx draws art over whichever it is given.
 */

export interface Point {
  x: number;
  y: number;
}

type Place = Exclude<LocationId, "lair">;

export interface BoardLayout {
  portrait: boolean;
  width: number;
  height: number;
  /** Side of one maze tile. */
  tile: number;
  /** Top-left corner of the 4x4 maze grid. */
  mazeOrigin: Point;
  lair: Point;
  /**
   * The maze is drawn turned a quarter anticlockwise: the engine's east (towards
   * the lair) points up the screen, north points left.
   */
  mazeTurned: boolean;
  /** Screen direction of the engine's east: the way through the maze. */
  mazeAhead: Point;
  /** Where tokens of players hidden in the maze are drawn. */
  hiddenAt: Point;
  /** Every board square except maze tiles. */
  positions: Map<NodeId, Point>;
  roomCenters: Record<string, Point>;
  tileCenter(row: number, col: number): Point;
  /** Position of any node, including maze tiles ("m:r:c"). */
  positionOf(id: NodeId): Point | undefined;
}

interface Spec {
  portrait: boolean;
  centers: Record<Place, Point>;
  squareGap: number;
  tile: number;
  mazeOrigin: Point;
  /** Lair distance from the maze's far edge. */
  lairGap: number;
  mazeTurned: boolean;
  hiddenAt: Point;
  width: number;
  height: number;
}

function build(spec: Spec): BoardLayout {
  const { centers, tile, mazeOrigin } = spec;
  const half = (MAZE_SIZE * tile) / 2;
  const mazeAhead: Point = spec.mazeTurned ? { x: 0, y: -1 } : { x: 1, y: 0 };
  const tileCenter = (row: number, col: number): Point =>
    spec.mazeTurned
      ? { x: mazeOrigin.x + row * tile + tile / 2, y: mazeOrigin.y + (MAZE_SIZE - 1 - col) * tile + tile / 2 }
      : { x: mazeOrigin.x + col * tile + tile / 2, y: mazeOrigin.y + row * tile + tile / 2 };
  const lair: Point = {
    x: mazeOrigin.x + half + mazeAhead.x * (half + spec.lairGap),
    y: mazeOrigin.y + half + mazeAhead.y * (half + spec.lairGap),
  };

  const pos = new Map<NodeId, Point>();
  pos.set("entrance", centers.entrance);
  pos.set("camp", centers.camp);
  pos.set("maze", centers.maze);
  pos.set("lair", lair);
  for (const room of ROOM_IDS) {
    const c = centers[room];
    const n = ROOM_SIZES[room];
    for (let i = 0; i < n; i++) pos.set(`${room}.${i}`, { x: c.x + (i - (n - 1) / 2) * spec.squareGap, y: c.y });
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

  return {
    portrait: spec.portrait,
    width: spec.width,
    height: spec.height,
    tile,
    mazeOrigin,
    lair,
    mazeTurned: spec.mazeTurned,
    mazeAhead,
    hiddenAt: spec.hiddenAt,
    positions: pos,
    roomCenters: Object.fromEntries(ROOM_IDS.map((r) => [r, centers[r]])),
    tileCenter,
    positionOf(id) {
      if (id.startsWith("m:")) {
        const [, r, c] = id.split(":");
        return tileCenter(Number(r), Number(c));
      }
      return pos.get(id);
    },
  };
}

// --- Landscape: [column (depth), row] on a grid ---
const COL = 175;
const ROW = 92;
const MARGIN = 50;
const TILE = 46;

const GRID: Record<Place, [number, number]> = {
  entrance: [0, 2.5],
  r1: [1, 1.5],
  r2: [1, 3.5],
  r3: [2, 0.5],
  r4: [2, 2.5],
  camp: [2.55, 2.1],
  r5: [2, 4.5],
  r6: [3, 1.5],
  r7: [3, 3],
  r8: [3, 4.8],
  r9: [4, 1.8],
  r10: [4, 4],
  maze: [5, 2.5],
};

const landscapeCenters = Object.fromEntries(
  Object.entries(GRID).map(([loc, [c, r]]) => [loc, { x: MARGIN + c * COL, y: MARGIN + r * ROW }]),
) as Record<Place, Point>;
const landscapeMaze: Point = {
  x: landscapeCenters.maze.x + 55,
  y: landscapeCenters.maze.y - (MAZE_SIZE * TILE) / 2,
};

export const LANDSCAPE: BoardLayout = build({
  portrait: false,
  centers: landscapeCenters,
  squareGap: 26,
  tile: TILE,
  mazeOrigin: landscapeMaze,
  lairGap: 70,
  mazeTurned: false,
  hiddenAt: { x: landscapeMaze.x + 8, y: landscapeMaze.y - 18 },
  width: landscapeMaze.x + MAZE_SIZE * TILE + 140,
  height: MARGIN * 2 + 4.8 * ROW + 20,
});

// --- Portrait: placed by hand in a 400-wide frame (about one unit per CSS pixel on a phone) ---
const P_TILE = 54;
const P_MAZE: Point = { x: 92, y: 96 };

export const PORTRAIT: BoardLayout = build({
  portrait: true,
  centers: {
    // The maze square sits right under the tile you enter by.
    maze: { x: P_MAZE.x + 1.5 * P_TILE, y: 356 },
    r9: { x: 124, y: 448 },
    r10: { x: 300, y: 448 },
    r6: { x: 70, y: 596 },
    r7: { x: 200, y: 596 },
    r8: { x: 338, y: 596 },
    camp: { x: 278, y: 674 },
    r3: { x: 70, y: 748 },
    r4: { x: 200, y: 748 },
    r5: { x: 335, y: 748 },
    r1: { x: 120, y: 896 },
    r2: { x: 290, y: 896 },
    entrance: { x: 200, y: 1024 },
  },
  squareGap: 28,
  tile: P_TILE,
  mazeOrigin: P_MAZE,
  lairGap: 48,
  mazeTurned: true,
  hiddenAt: { x: P_MAZE.x + 136, y: P_MAZE.y + MAZE_SIZE * P_TILE + 24 },
  width: 400,
  height: 1076,
});

/** Every board edge once, for drawing. */
export const EDGES: [NodeId, NodeId][] = (() => {
  const out: [NodeId, NodeId][] = [];
  for (const sq of Object.values(BOARD.squares)) {
    for (const n of sq.neighbors) if (sq.id < n) out.push([sq.id, n]);
  }
  return out;
})();
