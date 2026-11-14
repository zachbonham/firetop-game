import { BOARD, LAIR, MAZE_SQUARE, isMazeTile, locationOf } from "./board.js";
import {
  DIRS, E, ENTRY_ROW, MAZE_SIZE, W,
  inBounds, openings, opposite, parseTile, step, tileAt, tileId, tileKey,
} from "./maze.js";
import type { GameState, NodeId, Player } from "./types.js";

export interface Reach {
  dist: number;
  /** The node the player steps from to enter this one (used for fleeing). */
  parent: NodeId;
  /** Entering this node flips a face-down maze tile. */
  flip: boolean;
  /** For a flip: the side of the new tile the player enters through. */
  entrySide?: number;
}

interface Edge {
  to: NodeId;
  flip: boolean;
  entrySide?: number;
}

function isRevealed(p: Player, r: number, c: number): boolean {
  return tileKey(r, c) in p.maze;
}

function tileOpenings(state: GameState, p: Player, r: number, c: number): number {
  const rot = p.maze[tileKey(r, c)];
  if (rot === undefined) return 0;
  return openings(tileAt(state.mazeTiles, r, c), rot);
}

/** Edges out of a node, as seen by this player. */
export function edgesFrom(state: GameState, p: Player, node: NodeId): Edge[] {
  if (!isMazeTile(node)) {
    const out: Edge[] = (BOARD.squares[node]?.neighbors ?? []).map((to) => ({ to, flip: false }));
    if (node === MAZE_SQUARE) {
      if (!isRevealed(p, ENTRY_ROW, 0)) {
        out.push({ to: tileId(ENTRY_ROW, 0), flip: true, entrySide: W });
      } else if (tileOpenings(state, p, ENTRY_ROW, 0) & W) {
        out.push({ to: tileId(ENTRY_ROW, 0), flip: false });
      }
    }
    return out;
  }
  const [r, c] = parseTile(node);
  const o = tileOpenings(state, p, r, c);
  const out: Edge[] = [];
  for (const dir of DIRS) {
    if (!(o & dir)) continue;
    const [nr, nc] = step(r, c, dir);
    if (inBounds(nr, nc)) {
      if (!isRevealed(p, nr, nc)) {
        out.push({ to: tileId(nr, nc), flip: true, entrySide: opposite(dir) });
      } else if (tileOpenings(state, p, nr, nc) & opposite(dir)) {
        out.push({ to: tileId(nr, nc), flip: false });
      }
    } else if (dir === W && r === ENTRY_ROW && c === 0) {
      out.push({ to: MAZE_SQUARE, flip: false });
    } else if (dir === E && c === MAZE_SIZE - 1) {
      out.push({ to: LAIR, flip: false });
    }
  }
  return out;
}

/**
 * Every node this player can end a move on with a roll of `steps`.
 * You may move fewer squares than rolled. Entering a new location (or flipping
 * a maze tile) ends the move, so those nodes are not expanded further.
 */
export function reachable(state: GameState, p: Player, steps: number): Map<NodeId, Reach> {
  const start = p.pos;
  const startLoc = locationOf(start);
  const result = new Map<NodeId, Reach>();
  const seen = new Set<NodeId>([start]);
  let frontier: NodeId[] = [start];
  for (let d = 1; d <= steps && frontier.length; d++) {
    const next: NodeId[] = [];
    for (const node of frontier) {
      for (const e of edgesFrom(state, p, node)) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        const reach: Reach = { dist: d, parent: node, flip: e.flip };
        if (e.entrySide !== undefined) reach.entrySide = e.entrySide;
        result.set(e.to, reach);
        const loc = locationOf(e.to);
        const stops = e.flip || (loc !== null && loc !== startLoc);
        if (!stops) next.push(e.to);
      }
    }
    frontier = next;
  }
  return result;
}
