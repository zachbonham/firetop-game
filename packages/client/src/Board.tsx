import {
  ENTRY_ROW, E, ITEM_NAMES, MAZE_SIZE, N, S, W, ROOM_IDS, isMazeTile, locationOf, openings,
  type Encounter, type GameState, type NodeId, type PeekedEncounter, type PlayerView, type PublicEncounter, type TileType,
} from "@firetop/engine";
import {
  EDGES, HEIGHT, LAIR_POS, MAZE_ORIGIN, POSITIONS, ROOM_LABEL_POS, TILE, WIDTH,
  positionOf, tileCenter,
} from "./layout.js";
import { encounterLabel, seatColor } from "./describe.js";
import { Icon, type IconName } from "./art/icons.js";

interface Props {
  /**
   * What the viewer may see; the board draws from this alone (that's all an
   * online client has). null = god view: draw from `state` instead.
   */
  view: PlayerView | null;
  /** The full state: only needed (and only read) for the god view. */
  state?: GameState;
  /** God view only: whose maze tiles to draw. */
  mazeOf?: string | null;
  moveTargets: Set<NodeId>;
  selected: NodeId | null;
  selectedTile: string | null;
  onNodeClick: (id: NodeId) => void;
  onTileClick: (row: number, col: number) => void;
  /** Clicking a room that isn't a move target (e.g. to show its card). */
  onRoomClick?: (room: string) => void;
}

type AnyEncounter = Encounter | PublicEncounter | PeekedEncounter;

export function encounterIcon(e: AnyEncounter): IconName {
  if (e.kind === "monster") return "monster";
  if (e.kind === "trap") return "trap";
  if (e.kind === "treasure") return e.item;
  return "unknown";
}

const BIG: Record<string, { icon: IconName; label: string }> = {
  entrance: { icon: "entrance", label: "Entrance" },
  camp: { icon: "camp", label: "Camp" },
  maze: { icon: "maze", label: "Maze" },
  lair: { icon: "lair", label: "Lair" },
};

/** A maze tile as the board should draw it. */
interface TileInfo {
  /** Known tile type (revealed, being flipped, or god view). */
  type: TileType | null;
  /** The owner's rotation, if they have revealed it. */
  rotation: number | undefined;
  flipping: boolean;
}

export function Board(p: Props) {
  const god = p.view === null;
  const state = p.state;
  if (god && !state) throw new Error("Board: the god view needs the full state");
  const rooms = god ? null : p.view!.rooms;
  const players = god
    ? state!.players.map((pl) => ({ id: pl.id, name: pl.name, pos: pl.pos, status: pl.status }))
    : p.view!.players.map((pl) => ({ id: pl.id, name: pl.name, pos: pl.pos, status: pl.status }));
  const dropped = god ? state!.dropped : p.view!.dropped;
  const currentId = god ? state!.players[state!.currentIndex]?.id : p.view!.currentPlayerId;

  const tileInfo: (r: number, c: number) => TileInfo = god
    ? (() => {
      const owner = state!.players.find((x) => x.id === p.mazeOf);
      const flip = state!.pendingFlip && currentId === p.mazeOf ? state!.pendingFlip : null;
      return (r, c) => ({
        type: state!.mazeTiles[r * MAZE_SIZE + c]!,
        rotation: owner?.maze[`${r}:${c}`],
        flipping: !!flip && flip.row === r && flip.col === c,
      });
    })()
    : (() => {
      const mine = new Map((p.view!.me?.maze ?? []).map((t) => [`${t.row}:${t.col}`, t]));
      const flip = p.view!.me?.pendingFlip;
      return (r, c) => {
        const t = mine.get(`${r}:${c}`);
        const flipping = !!flip && flip.row === r && flip.col === c;
        return { type: t?.type ?? (flipping ? flip!.type : null), rotation: t?.rotation, flipping };
      };
    })();

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
    const x0 = Math.min(...xs) - 20, x1 = Math.max(...xs) + 20;
    const c = ROOM_LABEL_POS[room]!;
    const real = god ? state!.rooms[room]! : null;
    const pub = rooms?.[room];
    const cleared = real ? real.cleared : pub!.cleared;
    let enc: AnyEncounter | null = null;
    let secret = false;
    if (real) {
      enc = real.encounter;
      secret = !real.revealed;
    } else if (pub!.revealed && pub!.encounter) enc = pub!.encounter;
    else if (p.view!.me?.peeks[room]) {
      enc = p.view!.me.peeks[room]!;
      secret = true;
    }
    const label = enc ? `${secret && !god ? "📜 " : ""}${encounterLabel(enc)}` : "";
    const clickable = !!p.onRoomClick && !!enc;
    return (
      <g key={room} className={`room${cleared ? " cleared" : ""}${clickable ? " clickable" : ""}`} onClick={clickable ? () => p.onRoomClick!(room) : undefined} data-room={room}>
        <rect x={x0} y={c.y - 22} width={x1 - x0} height={44} rx={12} className="chamber" filter="url(#rough)" />
        <rect x={x0 + 4} y={c.y - 18} width={x1 - x0 - 8} height={36} rx={9} className="chamber-floor" />
        <g className="plaque">
          <rect x={c.x - 15} y={c.y - 33} width={30} height={14} rx={3} />
          <text x={c.x} y={c.y - 23}>{room.toUpperCase()}</text>
        </g>
        <g transform={`translate(${x1 - 2} ${c.y - 22})`}>
          <circle r={12} className={`emblem${secret ? " secret" : ""}`} />
          {enc ? <Icon name={encounterIcon(enc)} size={17} /> : <Icon name="unknown" size={20} />}
          {cleared && <text x={0} y={23} className="cleared-mark">✓</text>}
        </g>
        <text x={c.x} y={c.y + 36} className={`room-enc${secret ? " secret" : ""}`}>
          {label}
          <title>{enc ? describeForTitle(enc) : "Nobody has entered this room yet."}</title>
        </text>
      </g>
    );
  });

  const squares = [...POSITIONS.entries()].map(([id, pt]) => {
    const big = BIG[id];
    const target = p.moveTargets.has(id);
    const cls = ["sq", big ? "big" : "", id.startsWith("p:") ? "path" : "room-sq", target ? "target" : "", p.selected === id ? "selected" : ""].join(" ");
    return (
      <g key={id} onClick={() => p.onNodeClick(id)} className={target ? "clickable" : ""} data-node={id}>
        {/* Invisible, larger hit area so small squares are easy to click (and tap). */}
        <circle cx={pt.x} cy={pt.y} r={big ? 26 : 14} fill="transparent" />
        {big ? (
          <>
            <circle cx={pt.x} cy={pt.y} r={21} className={cls} filter="url(#rough)" />
            <Icon name={big.icon} x={pt.x} y={pt.y} size={26} color="#d9cfa8" />
            <text x={pt.x} y={pt.y + (id === "lair" ? 40 : -28)} className="big-label">{big.label}</text>
          </>
        ) : (
          <rect x={pt.x - 9} y={pt.y - 9} width={18} height={18} rx={4} className={cls} />
        )}
        <title>{id}</title>
      </g>
    );
  });

  const tiles = [];
  for (let r = 0; r < MAZE_SIZE; r++) {
    for (let c = 0; c < MAZE_SIZE; c++) {
      const key = `${r}:${c}`;
      const id = `m:${r}:${c}`;
      const { type, rotation: rot, flipping } = tileInfo(r, c);
      const showType: TileType | null = rot !== undefined || flipping || god ? type : null;
      const target = p.moveTargets.has(id);
      const facedown = rot === undefined && !flipping;
      const cls = ["tile", facedown ? "facedown" : "", target ? "target" : "", flipping ? "flipping" : "", p.selectedTile === key ? "selected" : ""].join(" ");
      const x = MAZE_ORIGIN.x + c * TILE, y = MAZE_ORIGIN.y + r * TILE;
      tiles.push(
        <g key={key} onClick={() => (target ? p.onNodeClick(id) : p.onTileClick(r, c))} className="clickable" data-node={id}>
          <rect x={x + 1} y={y + 1} width={TILE - 2} height={TILE - 2} rx={3} className={cls} />
          {facedown && !god && <Rune cx={x + TILE / 2} cy={y + TILE / 2} />}
          {showType && (
            <TilePaths cx={x + TILE / 2} cy={y + TILE / 2} size={TILE} mask={openings(showType, rot ?? 0)} ghost={rot === undefined} />
          )}
          <title>{`${id}${showType ? ` ${showType}` : ""}${rot === undefined && god ? " (not revealed by this player)" : ""}`}</title>
        </g>,
      );
    }
  }

  const entry = tileCenter(ENTRY_ROW, 0);
  const mazeSq = POSITIONS.get("maze")!;
  const mazeW = MAZE_SIZE * TILE;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="board" role="img" aria-label="Game board">
      <BoardDefs />
      <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#ground)" />
      <Mountain />
      <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#vignette)" pointerEvents="none" />

      {EDGES.map(([a, b]) => {
        const pa = POSITIONS.get(a)!, pb = POSITIONS.get(b)!;
        return <line key={`${a}|${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="corridor" />;
      })}
      <line x1={mazeSq.x} y1={mazeSq.y} x2={entry.x - TILE / 2} y2={entry.y} className="corridor" />
      {[0, 1, 2, 3].map((r) => {
        const t = tileCenter(r, MAZE_SIZE - 1);
        return <line key={r} x1={t.x + TILE / 2} y1={t.y} x2={LAIR_POS.x} y2={LAIR_POS.y} className="corridor exit" />;
      })}
      {roomBoxes}
      <rect x={MAZE_ORIGIN.x - 6} y={MAZE_ORIGIN.y - 6} width={mazeW + 12} height={mazeW + 12} rx={8} className="maze-frame" filter="url(#rough)" />
      {squares}
      <g className="maze">{tiles}</g>
      {Object.entries(dropped).map(([node, keys]) => {
        const pt = positionOf(node);
        if (!pt) return null;
        return (
          <g key={node} className="dropped" pointerEvents="none">
            <Icon name="key" x={pt.x - 8} y={pt.y + 22} size={14} color="#f0c24a" />
            <text x={pt.x + 1} y={pt.y + 26}>{keys.join(",")}</text>
          </g>
        );
      })}
      {[...byNode.entries()].map(([node, list]) => {
        const pt = positionOf(node);
        if (!pt) return null;
        return list.map((pl, i) => (
          <Token key={pl.id} x={pt.x + (i - (list.length - 1) / 2) * 15} y={pt.y - (isMazeTile(node) ? 0 : 3)} idx={pl.idx} name={pl.name} current={pl.id === currentId} />
        ));
      })}
      {hidden.map((pl, i) => (
        <Token key={pl.id} x={MAZE_ORIGIN.x + i * 18 + 8} y={MAZE_ORIGIN.y - 18} idx={pl.idx} name={pl.name} current={pl.id === currentId} />
      ))}
      {hidden.length > 0 && <text x={MAZE_ORIGIN.x + hidden.length * 18 + 8} y={MAZE_ORIGIN.y - 14} className="hint">in the maze (position hidden)</text>}
    </svg>
  );
}

function describeForTitle(e: AnyEncounter): string {
  if (e.kind === "treasure") return `${ITEM_NAMES[e.item]}${e.key !== null ? ` and key ${e.key}` : ""}`;
  return encounterLabel(e);
}

/** Shared SVG definitions: ground texture, rough edges, vignette. */
function BoardDefs() {
  return (
    <defs>
      <radialGradient id="ground" cx="45%" cy="55%" r="80%">
        <stop offset="0%" stopColor="#3a3227" />
        <stop offset="60%" stopColor="#2a241d" />
        <stop offset="100%" stopColor="#1a1612" />
      </radialGradient>
      <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
        <stop offset="65%" stopColor="#000" stopOpacity={0} />
        <stop offset="100%" stopColor="#000" stopOpacity={0.55} />
      </radialGradient>
      <filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves={2} seed={3} result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale={4} />
      </filter>
      <linearGradient id="stone" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#6e665a" />
        <stop offset="100%" stopColor="#4a443b" />
      </linearGradient>
      <linearGradient id="slate" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#3b3a45" />
        <stop offset="100%" stopColor="#25242c" />
      </linearGradient>
    </defs>
  );
}

/** A dark mountain silhouette behind the maze and lair. */
function Mountain() {
  const x0 = MAZE_ORIGIN.x - 260, base = HEIGHT;
  const peak = LAIR_POS.x - 60;
  return (
    <g className="mountain" pointerEvents="none">
      <path d={`M${x0} ${base} L${x0 + 140} ${base - 150} L${x0 + 200} ${base - 130} L${peak - 90} ${base - 330} L${peak - 40} ${base - 300} L${peak} ${base - 400} L${peak + 60} ${base - 330} L${WIDTH} ${base - 260} L${WIDTH} ${base} Z`} />
      <path d={`M${peak - 14} ${base - 378} L${peak} ${base - 400} L${peak + 16} ${base - 376} L${peak + 4} ${base - 382} Z`} className="snow" />
    </g>
  );
}

function Rune({ cx, cy }: { cx: number; cy: number }) {
  return <path d={`M${cx} ${cy - 7}l6 7l-6 7l-6 -7z M${cx} ${cy - 3}v6`} className="rune" pointerEvents="none" />;
}

function Token({ x, y, idx, name, current }: { x: number; y: number; idx: number; name: string; current: boolean }) {
  return (
    <g className={`token${current ? " current" : ""}`} pointerEvents="none">
      {current && <circle cx={x} cy={y + 2} r={12} className="token-glow" />}
      <path d={`M${x - 7} ${y + 9} q0 -8 4 -9 a5.5 5.5 0 1 1 6 0 q4 1 4 9 z`} fill={seatColor(idx)} />
      <text x={x} y={y + 1}>{name.slice(0, 1).toUpperCase()}</text>
    </g>
  );
}

/** A maze tile's corridors: carved channels from the centre to each open side. */
export function TilePaths({ cx, cy, size, mask, ghost }: { cx: number; cy: number; size: number; mask: number; ghost?: boolean }) {
  const h = size / 2;
  const ends: [number, number, number][] = [[N, 0, -h], [E, h, 0], [S, 0, h], [W, -h, 0]];
  const open = ends.filter(([d]) => mask & d);
  return (
    <g className={`tile-paths${ghost ? " ghost" : ""}`} pointerEvents="none">
      {open.map(([d, dx, dy]) => <line key={`e${d}`} x1={cx} y1={cy} x2={cx + dx} y2={cy + dy} className="carve-edge" />)}
      <circle cx={cx} cy={cy} r={size * 0.19} className="carve-edge" />
      {open.map(([d, dx, dy]) => <line key={`c${d}`} x1={cx} y1={cy} x2={cx + dx} y2={cy + dy} className="carve" />)}
      <circle cx={cx} cy={cy} r={size * 0.15} className="carve" />
    </g>
  );
}

/** A small standalone tile drawing (for the orient / re-turn pickers). */
export function TileIcon({ type, rotation, size = 44, entrySide }: { type: TileType; rotation: number; size?: number; entrySide?: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="tile-icon">
      <rect x={0.5} y={0.5} width={size - 1} height={size - 1} rx={3} className="tile" />
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
