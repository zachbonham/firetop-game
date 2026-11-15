import {
  ENTRY_ROW, E, MAZE_SIZE, N, S, W, ROOM_IDS, isMazeTile, locationOf, openings,
  type GameState, type NodeId, type PlayerView, type TileType,
} from "@firetop/engine";
import {
  EDGES, HEIGHT, LAIR_POS, MAZE_ORIGIN, POSITIONS, ROOM_LABEL_POS, TILE, WIDTH,
  positionOf, tileCenter,
} from "./layout.js";
import { encounterLabel, seatColor } from "./describe.js";

interface Props {
  state: GameState;
  /** What the viewer may see. null = god view (draw from the full state). */
  view: PlayerView | null;
  /** Whose maze tiles to draw (viewer, or the current player in god view). */
  mazeOf: string | null;
  moveTargets: Set<NodeId>;
  selected: NodeId | null;
  selectedTile: string | null;
  onNodeClick: (id: NodeId) => void;
  onTileClick: (row: number, col: number) => void;
}

export function Board(p: Props) {
  const god = p.view === null;
  const rooms = god ? null : p.view!.rooms;
  const players = god
    ? p.state.players.map((pl) => ({ id: pl.id, name: pl.name, pos: pl.pos, status: pl.status }))
    : p.view!.players.map((pl) => ({ id: pl.id, name: pl.name, pos: pl.pos, status: pl.status }));
  const dropped = god ? p.state.dropped : p.view!.dropped;
  const mazeOwner = p.state.players.find((x) => x.id === p.mazeOf);
  const flip = p.state.pendingFlip && p.state.players[p.state.currentIndex]?.id === p.mazeOf ? p.state.pendingFlip : null;

  // Group player tokens by node.
  const byNode = new Map<NodeId, { id: string; name: string; idx: number }[]>();
  const hidden: { id: string; name: string; idx: number }[] = [];
  players.forEach((pl, idx) => {
    if (pl.status !== "active") return;
    if (pl.pos === "maze:hidden") {
      hidden.push({ ...pl, idx });
      return;
    }
    const list = byNode.get(pl.pos) ?? [];
    list.push({ ...pl, idx });
    byNode.set(pl.pos, list);
  });

  const roomBoxes = ROOM_IDS.map((room) => {
    const squares = [...POSITIONS.entries()].filter(([id]) => locationOf(id) === room).map(([, pt]) => pt);
    const xs = squares.map((s) => s.x);
    const x0 = Math.min(...xs) - 18, x1 = Math.max(...xs) + 18;
    const c = ROOM_LABEL_POS[room]!;
    const real = p.state.rooms[room]!;
    const seen = god ? (real.revealed ? real : null) : rooms![room]!.revealed ? rooms![room]! : null;
    const cleared = god ? real.cleared : rooms![room]!.cleared;
    let label = "?";
    let secret = false;
    if (seen) label = encounterLabel(god ? real.encounter : rooms![room]!.encounter!);
    else if (god) {
      label = encounterLabel(real.encounter);
      secret = true;
    } else if (p.view!.me?.peeks[room]) {
      label = `📜 ${encounterLabel(p.view!.me.peeks[room]!)}`;
      secret = true;
    }
    return (
      <g key={room} className={`room${cleared ? " cleared" : ""}`}>
        <rect x={x0} y={c.y - 18} width={x1 - x0} height={36} rx={8} />
        <text x={c.x} y={c.y - 24} className="room-name">{room.toUpperCase()}</text>
        <text x={c.x} y={c.y + 32} className={`room-enc${secret ? " secret" : ""}`}>{label}</text>
      </g>
    );
  });

  const squares = [...POSITIONS.entries()].map(([id, pt]) => {
    const big = id === "entrance" || id === "camp" || id === "maze" || id === "lair";
    const target = p.moveTargets.has(id);
    const cls = ["sq", big ? "big" : "", id.startsWith("p:") ? "path" : "", target ? "target" : "", p.selected === id ? "selected" : ""].join(" ");
    return (
      <g key={id} onClick={() => p.onNodeClick(id)} className={target ? "clickable" : ""} data-node={id}>
        {/* Invisible, larger hit area so small squares are easy to click. */}
        <circle cx={pt.x} cy={pt.y} r={big ? 24 : 13} fill="transparent" />
        <circle cx={pt.x} cy={pt.y} r={big ? 20 : 9} className={cls}>
          <title>{id}</title>
        </circle>
        {big && <text x={pt.x} y={pt.y + (id === "lair" ? 40 : -26)} className="big-label">{id === "maze" ? "Maze" : id === "lair" ? "Lair" : id === "camp" ? "⛺ Camp" : "Entrance"}</text>}
      </g>
    );
  });

  const tiles = [];
  for (let r = 0; r < MAZE_SIZE; r++) {
    for (let c = 0; c < MAZE_SIZE; c++) {
      const key = `${r}:${c}`;
      const id = `m:${r}:${c}`;
      const rot = mazeOwner?.maze[key];
      const flipping = flip && flip.row === r && flip.col === c;
      const type = p.state.mazeTiles[r * MAZE_SIZE + c]!;
      const showType: TileType | null = rot !== undefined || flipping || god ? type : null;
      const target = p.moveTargets.has(id);
      const cls = ["tile", rot === undefined && !flipping ? "facedown" : "", target ? "target" : "", flipping ? "flipping" : "", p.selectedTile === key ? "selected" : ""].join(" ");
      tiles.push(
        <g key={key} onClick={() => (target ? p.onNodeClick(id) : p.onTileClick(r, c))} className="clickable" data-node={id}>
          <rect x={MAZE_ORIGIN.x + c * TILE} y={MAZE_ORIGIN.y + r * TILE} width={TILE} height={TILE} className={cls} />
          {showType && (
            <TilePaths
              cx={MAZE_ORIGIN.x + c * TILE + TILE / 2}
              cy={MAZE_ORIGIN.y + r * TILE + TILE / 2}
              size={TILE}
              mask={openings(showType, rot ?? 0)}
              ghost={rot === undefined}
            />
          )}
          <title>{`${id}${showType ? ` ${showType}` : ""}${rot === undefined && god ? " (not revealed by this player)" : ""}`}</title>
        </g>,
      );
    }
  }

  const entry = tileCenter(ENTRY_ROW, 0);
  const mazeSq = POSITIONS.get("maze")!;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="board">
      {EDGES.map(([a, b]) => {
        const pa = POSITIONS.get(a)!, pb = POSITIONS.get(b)!;
        return <line key={`${a}|${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="edge" />;
      })}
      <line x1={mazeSq.x} y1={mazeSq.y} x2={entry.x - TILE / 2} y2={entry.y} className="edge maze-link" />
      {[0, 1, 2, 3].map((r) => {
        const t = tileCenter(r, MAZE_SIZE - 1);
        return <line key={r} x1={t.x + TILE / 2} y1={t.y} x2={LAIR_POS.x} y2={LAIR_POS.y} className="edge exit" />;
      })}
      {roomBoxes}
      {squares}
      <g className="maze">{tiles}</g>
      {Object.entries(dropped).map(([node, keys]) => {
        const pt = positionOf(node);
        if (!pt) return null;
        return <text key={node} x={pt.x} y={pt.y + 22} className="dropped">🔑{keys.join(",")}</text>;
      })}
      {[...byNode.entries()].map(([node, list]) => {
        const pt = positionOf(node);
        if (!pt) return null;
        return list.map((pl, i) => (
          <Token key={pl.id} x={pt.x + (i - (list.length - 1) / 2) * 15} y={pt.y - (isMazeTile(node) ? 0 : 2)} idx={pl.idx} name={pl.name} />
        ));
      })}
      {hidden.map((pl, i) => (
        <g key={pl.id}>
          <Token x={MAZE_ORIGIN.x + i * 18 + 8} y={MAZE_ORIGIN.y - 16} idx={pl.idx} name={pl.name} />
        </g>
      ))}
      {hidden.length > 0 && <text x={MAZE_ORIGIN.x + hidden.length * 18 + 8} y={MAZE_ORIGIN.y - 12} className="hint">in the maze (position hidden)</text>}
    </svg>
  );
}

function Token({ x, y, idx, name }: { x: number; y: number; idx: number; name: string }) {
  return (
    <g className="token" pointerEvents="none">
      <circle cx={x} cy={y} r={8} fill={seatColor(idx)} />
      <text x={x} y={y + 3.5}>{name.slice(0, 1).toUpperCase()}</text>
    </g>
  );
}

export function TilePaths({ cx, cy, size, mask, ghost }: { cx: number; cy: number; size: number; mask: number; ghost?: boolean }) {
  const h = size / 2;
  const ends: [number, number, number][] = [[N, 0, -h], [E, h, 0], [S, 0, h], [W, -h, 0]];
  return (
    <g className={`tile-paths${ghost ? " ghost" : ""}`} pointerEvents="none">
      {ends.filter(([d]) => mask & d).map(([d, dx, dy]) => (
        <line key={d} x1={cx} y1={cy} x2={cx + dx} y2={cy + dy} />
      ))}
      <circle cx={cx} cy={cy} r={size * 0.11} />
    </g>
  );
}

/** A small standalone tile drawing (for the orient / re-turn pickers). */
export function TileIcon({ type, rotation, size = 44, entrySide }: { type: TileType; rotation: number; size?: number; entrySide?: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="tile-icon">
      <rect x={0.5} y={0.5} width={size - 1} height={size - 1} className="tile" />
      <TilePaths cx={size / 2} cy={size / 2} size={size} mask={openings(type, rotation)} />
      {entrySide !== undefined && <EntryMark side={entrySide} size={size} />}
    </svg>
  );
}

function EntryMark({ side, size }: { side: number; size: number }) {
  const m = size / 2;
  const pos: Record<number, [number, number]> = { [N]: [m, 3], [E]: [size - 3, m], [S]: [m, size - 3], [W]: [3, m] };
  const [x, y] = pos[side] ?? [m, m];
  return <circle cx={x} cy={y} r={3} className="entry-mark" />;
}

