import { isMazeTile } from "./board.js";
import { tileAt } from "./maze.js";
import { reachable } from "./movement.js";
import type { ChestGuess, Encounter, GameConfig, GameEvent, NodeId, Phase, PlayerSettings, TileType } from "./types.js";
import type { GameState } from "./types.js";

/**
 * What one player is allowed to see. The server sends only this, never the
 * full GameState: the chest combination, the maze deal, hidden encounters,
 * the RNG state and other players' maze views stay on the server.
 */

export type PublicEncounter =
  | { kind: "monster"; name: string; skill: number; stamina: number }
  | Exclude<Encounter, { kind: "monster" }>;

export interface PublicRoom {
  revealed: boolean;
  cleared: boolean;
  encounter?: PublicEncounter;
}

/** Shown instead of a position for another player inside the maze grid. */
export const HIDDEN_MAZE_POS = "maze:hidden";

export interface PublicPlayer {
  id: string;
  name: string;
  archetype: string;
  skill: number;
  stamina: number;
  maxStamina: number;
  luck: number;
  keys: number[];
  /** Board node, or HIDDEN_MAZE_POS for another player inside the maze grid. */
  pos: NodeId;
  inMaze: boolean;
  status: "active" | "removed";
  skipNextTurn: boolean;
  protected: boolean;
  wizardBeaten: boolean;
}

export interface MazeTileView {
  row: number;
  col: number;
  type: TileType;
  rotation: number;
}

export interface PlayerView {
  viewerId: string | null;
  /** Rule numbers for this game (public). */
  config: GameConfig;
  turn: number;
  phase: Phase;
  currentPlayerId: string;
  pendingRoll: number | null;
  winner: string | null;
  players: PublicPlayer[];
  rooms: Record<string, PublicRoom>;
  dropped: Record<NodeId, number[]>;
  guesses: ChestGuess[];
  log: GameEvent[];
  /** Only for the viewer. */
  me?: {
    settings: PlayerSettings;
    pos: NodeId;
    maze: MazeTileView[];
    /** The tile the viewer just flipped and must turn (orient phase). */
    pendingFlip?: { row: number; col: number; type: TileType; entrySide: number };
    /** Squares the viewer can move to right now (move phase, their turn). */
    moveOptions: { to: NodeId; flip: boolean; entrySide?: number }[];
  };
}

export function playerView(s: GameState, viewerId: string | null): PlayerView {
  const current = s.players[s.currentIndex]!;
  const players: PublicPlayer[] = s.players.map((p) => {
    const inMaze = isMazeTile(p.pos);
    return {
      id: p.id,
      name: p.name,
      archetype: p.archetype,
      skill: p.skill,
      stamina: p.stamina,
      maxStamina: p.maxStamina,
      luck: p.luck,
      keys: [...p.keys],
      pos: inMaze && p.id !== viewerId ? HIDDEN_MAZE_POS : p.pos,
      inMaze,
      status: p.status,
      skipNextTurn: p.skipNextTurn,
      protected: p.protected,
      wizardBeaten: p.wizardBeaten,
    };
  });

  const rooms: Record<string, PublicRoom> = {};
  for (const [id, r] of Object.entries(s.rooms)) {
    const room: PublicRoom = { revealed: r.revealed, cleared: r.cleared };
    if (r.revealed) {
      const e = r.encounter;
      room.encounter = e.kind === "monster"
        ? { kind: "monster", name: e.name, skill: e.skill, stamina: e.stamina }
        : e;
    }
    rooms[id] = room;
  }

  // Keys dropped inside the maze grid would reveal a tile position; hide them from others.
  const dropped: Record<NodeId, number[]> = {};
  for (const [node, keys] of Object.entries(s.dropped)) {
    if (isMazeTile(node)) continue;
    dropped[node] = [...keys];
  }

  const view: PlayerView = {
    viewerId,
    config: structuredClone(s.config),
    turn: s.turn,
    phase: s.phase,
    currentPlayerId: current.id,
    pendingRoll: s.pendingRoll,
    winner: s.winner,
    players,
    rooms,
    dropped,
    guesses: s.guesses.map((g) => ({ ...g, keys: [...g.keys] })),
    log: s.log.filter((e) => !e.privateTo || e.privateTo === viewerId),
  };

  const me = s.players.find((p) => p.id === viewerId);
  if (me) {
    const maze: MazeTileView[] = Object.entries(me.maze).map(([key, rotation]) => {
      const [row, col] = key.split(":").map(Number) as [number, number];
      return { row, col, type: tileAt(s.mazeTiles, row, col), rotation };
    });
    const moveOptions =
      s.phase === "move" && current.id === me.id && s.pendingRoll !== null
        ? [...reachable(s, me, s.pendingRoll)].map(([to, r]) => {
            const o: { to: NodeId; flip: boolean; entrySide?: number } = { to, flip: r.flip };
            if (r.entrySide !== undefined) o.entrySide = r.entrySide;
            return o;
          })
        : [];
    view.me = { settings: { ...me.settings }, pos: me.pos, maze, moveOptions };
    if (s.pendingFlip && current.id === me.id) {
      const { row, col, entrySide } = s.pendingFlip;
      view.me.pendingFlip = { row, col, type: tileAt(s.mazeTiles, row, col), entrySide };
    }
  }
  return view;
}
