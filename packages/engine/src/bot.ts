/**
 * A simple scripted player for simulation, tests and bot seats on the local
 * test board. It decides from playerView() alone, so it sees exactly what a
 * human would.
 */
import { BOARD, LAIR, MAZE_SQUARE, isMazeTile } from "./board.js";
import { candidateCombos } from "./combos.js";
import { E, ENTRY_ROW, MAZE_SIZE, N, S, W, openings, rotate } from "./maze.js";
import type { Action, NodeId, TileType } from "./types.js";
import type { MazeTileView, PlayerView } from "./view.js";

const DIRS = [N, E, S, W] as const;

function stepRC(r: number, c: number, d: number): [number, number] {
  return d === N ? [r - 1, c] : d === S ? [r + 1, c] : d === E ? [r, c + 1] : [r, c - 1];
}

function inBounds(r: number, c: number) {
  return r >= 0 && c >= 0 && r < MAZE_SIZE && c < MAZE_SIZE;
}

function multiSourceDistances(sources: NodeId[]): Map<NodeId, number> {
  const dist = new Map<NodeId, number>();
  const queue: NodeId[] = [];
  for (const s of sources) {
    if (BOARD.squares[s] && !dist.has(s)) {
      dist.set(s, 0);
      queue.push(s);
    }
  }
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of BOARD.squares[cur]!.neighbors) {
      if (!dist.has(n)) {
        dist.set(n, dist.get(cur)! + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

function goMazeNow(usable: number[][]) {
  return usable.length > 0;
}

/** Pick an action for the viewer of `view` (it must be their turn). */
export function botAction(view: PlayerView): Action {
  const me = view.players.find((p) => p.id === view.viewerId)!;
  const mine = view.me!;
  const cfg = view.config;
  const mazeView = new Map(mine.maze.map((t) => [`${t.row}:${t.col}`, openings(t.type, t.rotation)]));
  const revealed = (r: number, c: number) => mazeView.has(`${r}:${c}`);

  const candidates = candidateCombos(cfg.keyCount, cfg.comboSize, view.guesses);
  const usable = candidates.filter((combo) => combo.every((k) => me.keys.includes(k)));
  const neededKeys = new Set(candidates.flat().filter((k) => !me.keys.includes(k)));

  if (view.phase === "orient") {
    const f = mine.pendingFlip!;
    let best = 0;
    let bestScore = -Infinity;
    for (let rot = 0; rot < 4; rot++) {
      const o = openings(f.type, rot);
      if (!(o & f.entrySide)) continue;
      let score = 0;
      for (const d of DIRS) {
        if (!(o & d) || d === f.entrySide) continue;
        const [nr, nc] = stepRC(f.row, f.col, d);
        if (d === E) score += f.col === MAZE_SIZE - 1 ? 100 : 6;
        else if (inBounds(nr, nc)) score += revealed(nr, nc) ? 1 : 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = rot;
      }
    }
    return { type: "orientTile", rotation: best };
  }

  if (view.phase === "roll") {
    if (me.pos === LAIR) {
      if (me.wizardBeaten && usable.length > 0 && me.stamina > cfg.wrongGuessDamage) {
        return { type: "guessChest", keys: usable[0]! };
      }
      if (me.wizardBeaten && usable.length > 0) return { type: "rest" };
      return { type: "leaveLair" };
    }
    if (me.stamina >= 8 && !isMazeTile(mine.pos)) {
      const victim = view.players.find(
        (p) => p.id !== me.id && p.status === "active" && !p.protected && !p.inMaze && p.pos === mine.pos && p.keys.length > 0
          && me.stamina + 2 * me.skill >= p.stamina + 2 * p.skill + 2,
      );
      if (victim && (victim.keys.some((k) => neededKeys.has(k)) || me.keys.length < cfg.comboSize)) {
        return { type: "attack", target: victim.id, stealKey: victim.keys.find((k) => neededKeys.has(k)) ?? victim.keys[0]! };
      }
    }
    if (me.stamina < 6) return { type: "rest" };
    // Only key source left is other players: heal up to fight.
    const roomsLeft = Object.values(view.rooms).some((r) => !r.cleared) || Object.keys(view.dropped).length > 0;
    if (!roomsLeft && !goMazeNow(usable) && me.stamina < 10) return { type: "rest" };
    // Heal up before the duel.
    if ((isMazeTile(mine.pos) || mine.pos === MAZE_SQUARE) && goMazeNow(usable) && me.stamina < Math.ceil(me.maxStamina * 0.75)) {
      return { type: "rest" };
    }
    const inMazeArea = isMazeTile(mine.pos) || mine.pos === MAZE_SQUARE;
    if (inMazeArea && (goMazeNow(usable) || isMazeTile(mine.pos)) && !mazeHasProgress(mine.pos, mazeView)) {
      const plan = planMaze(mine.pos, mine.maze);
      if (plan?.kind === "rotate") return { type: "rotateTile", row: plan.row, col: plan.col, rotation: plan.rotation };
    }
    return { type: "roll" };
  }

  // Move phase
  const options = mine.moveOptions;
  const goMaze = usable.length > 0;

  // Opportunistic attack on a key holder.
  if (me.stamina >= 8) {
    for (const o of options) {
      const victim = view.players.find(
        (p) => p.id !== me.id && p.status === "active" && !p.protected && p.pos === o.to && p.keys.length > 0 && !p.inMaze
          && me.stamina + 2 * me.skill >= p.stamina + 2 * p.skill + 2,
      );
      if (victim && (victim.keys.some((k) => neededKeys.has(k)) || me.keys.length < cfg.comboSize)) {
        const stealKey = victim.keys.find((k) => neededKeys.has(k)) ?? victim.keys[0]!;
        return { type: "move", to: o.to, attack: victim.id, stealKey };
      }
    }
  }

  const score = new Map<NodeId, number>();
  let walkGoal: string | null = null;
  if ((isMazeTile(mine.pos) || mine.pos === MAZE_SQUARE) && !mazeHasProgress(mine.pos, mazeView)) {
    const plan = planMaze(mine.pos, mine.maze);
    if (plan?.kind === "walk") walkGoal = plan.goal;
  }
  if (goMaze || isMazeTile(mine.pos) || mine.pos === MAZE_SQUARE) {
    const dist = multiSourceDistances([MAZE_SQUARE]);
    for (const o of options) {
      let v: number;
      if (o.to === LAIR) v = 10_000;
      else if (isMazeTile(o.to)) {
        const [, c] = o.to.slice(2).split(":").map(Number) as [number, number];
        const toFrontier = walkGoal ? tileDistance(o.to.slice(2), walkGoal, mazeView) : frontierDistance(o.to.slice(2), mazeView);
        v = o.flip ? 5000 + c * 10 : 1000 - toFrontier * 20 + c;
      } else if (!goMaze) {
        v = -1; // left the maze but still needs keys: handled below
      } else v = -(dist.get(o.to) ?? 99);
      score.set(o.to, v);
    }
    if (!goMaze && !isMazeTile(mine.pos)) score.clear();
  }

  if (score.size === 0) {
    const goals: NodeId[] = [];
    for (const [room, info] of Object.entries(view.rooms)) {
      if (info.cleared) continue;
      if (info.revealed && info.encounter?.kind === "monster" && info.encounter.skill > me.skill + 1 && me.stamina < 12) continue;
      goals.push(...Object.keys(BOARD.squares).filter((id) => BOARD.squares[id]!.location === room));
    }
    goals.push(...Object.keys(view.dropped));
    for (const p of view.players) {
      if (p.id !== me.id && p.status === "active" && !p.inMaze && p.keys.length > 0 && me.stamina >= 8 && p.pos !== mine.pos) {
        goals.push(p.pos);
      }
    }
    if (goals.length === 0) goals.push(MAZE_SQUARE);
    const dist = multiSourceDistances(goals);
    for (const o of options) score.set(o.to, -(dist.get(o.to) ?? 99));
  }

  let best = options[0]!;
  for (const o of options) if ((score.get(o.to) ?? -999) > (score.get(best.to) ?? -999)) best = o;
  return { type: "move", to: best.to };
}

/** Can the bot still reach an unexplored tile or the exit through its revealed tiles? */
function mazeHasProgress(pos: NodeId, maze: Map<string, number>): boolean {
  if (pos === MAZE_SQUARE) {
    const entry = maze.get(`${ENTRY_ROW}:0`);
    if (entry === undefined) return true;
    if (!(entry & W)) return false;
    return mazeHasProgress(`m:${ENTRY_ROW}:0`, maze);
  }
  const start = pos.slice(2);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const key = queue.shift()!;
    const [r, c] = key.split(":").map(Number) as [number, number];
    const o = maze.get(key) ?? 0;
    for (const d of DIRS) {
      if (!(o & d)) continue;
      if (d === E && c === MAZE_SIZE - 1) return true;
      const [nr, nc] = stepRC(r, c, d);
      if (!inBounds(nr, nc)) continue;
      const nk = `${nr}:${nc}`;
      if (!maze.has(nk)) return true;
      const back = d === N ? S : d === S ? N : d === E ? W : E;
      if ((maze.get(nk)! & back) && !seen.has(nk)) {
        seen.add(nk);
        queue.push(nk);
      }
    }
  }
  return false;
}

/** Steps through revealed tiles from `start` to the nearest tile that opens onto unexplored ground or the exit. */
function frontierDistance(start: string, maze: Map<string, number>): number {
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const key = queue.shift()!;
    const [r, c] = key.split(":").map(Number) as [number, number];
    const o = maze.get(key) ?? 0;
    for (const d of DIRS) {
      if (!(o & d)) continue;
      if (d === E && c === MAZE_SIZE - 1) return dist.get(key)!;
      const [nr, nc] = stepRC(r, c, d);
      if (!inBounds(nr, nc)) continue;
      const nk = `${nr}:${nc}`;
      if (!maze.has(nk)) return dist.get(key)!;
      const back = d === N ? S : d === S ? N : d === E ? W : E;
      if ((maze.get(nk)! & back) && !dist.has(nk)) {
        dist.set(nk, dist.get(key)! + 1);
        queue.push(nk);
      }
    }
  }
  return 99;
}

function tileDistance(start: string, goal: string, maze: Map<string, number>): number {
  if (start === goal) return 0;
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const key = queue.shift()!;
    const [r, c] = key.split(":").map(Number) as [number, number];
    const o = maze.get(key) ?? 0;
    for (const d of DIRS) {
      if (!(o & d)) continue;
      const [nr, nc] = stepRC(r, c, d);
      const nk = `${nr}:${nc}`;
      if (!inBounds(nr, nc) || !maze.has(nk) || dist.has(nk)) continue;
      const back = d === N ? S : d === S ? N : d === E ? W : E;
      if (!(maze.get(nk)! & back)) continue;
      dist.set(nk, dist.get(key)! + 1);
      if (nk === goal) return dist.get(nk)!;
      queue.push(nk);
    }
  }
  return 99;
}

type MazePlan = { kind: "rotate"; row: number; col: number; rotation: number } | { kind: "walk"; goal: string };

function rotationFor(type: TileType, sides: number): number | null {
  for (let r = 0; r < 4; r++) if ((rotate(BASE_OF(type), r) & sides) === sides) return r;
  return null;
}
function BASE_OF(type: TileType): number {
  return openings(type, 0);
}

/**
 * When stuck: find a route through revealed tiles assuming any tile can be re-turned,
 * then fix the first broken link (re-turn it if adjacent, otherwise walk next to it).
 */
function planMaze(pos: NodeId, tiles: MazeTileView[]): MazePlan | null {
  const info = new Map(tiles.map((t) => [`${t.row}:${t.col}`, t]));
  const atSquare = pos === MAZE_SQUARE;
  const startKey = atSquare ? `${ENTRY_ROW}:0` : pos.slice(2);
  if (!info.has(startKey)) return null;
  type Node = { key: string; from: number; out: number; prev: Node | null };
  const startFrom = atSquare ? W : 0;
  const queue: Node[] = [];
  const seen = new Set<string>();
  const push = (key: string, from: number, prev: Node | null) => {
    const id = `${key}/${from}`;
    if (seen.has(id)) return;
    seen.add(id);
    queue.push({ key, from, out: 0, prev });
  };
  push(startKey, startFrom, null);
  let end: Node | null = null;
  while (queue.length && !end) {
    const node = queue.shift()!;
    const t = info.get(node.key)!;
    const base = openings(t.type, 0);
    for (const d of DIRS) {
      if (d === node.from) continue;
      const need = node.from | d;
      if (rotationFor(t.type, need) === null || !base) continue;
      const [nr, nc] = stepRC(t.row, t.col, d);
      const exitHere = d === E && t.col === MAZE_SIZE - 1;
      const frontier = inBounds(nr, nc) && !info.has(`${nr}:${nc}`);
      if (exitHere || frontier) {
        end = { ...node, out: d };
        break;
      }
      if (inBounds(nr, nc)) {
        const back = d === N ? S : d === S ? N : d === E ? W : E;
        const child: Node = { key: `${nr}:${nc}`, from: back, out: 0, prev: { ...node, out: d } };
        const id = `${child.key}/${back}`;
        if (!seen.has(id)) {
          seen.add(id);
          queue.push(child);
        }
      }
    }
  }
  if (!end) return null;
  const path: Node[] = [];
  for (let n: Node | null = end; n; n = n.prev) path.unshift(n);
  for (let i = 0; i < path.length; i++) {
    const n = path[i]!;
    const t = info.get(n.key)!;
    const o = openings(t.type, t.rotation);
    const need = n.from | n.out;
    if ((o & need) === need) continue;
    const rotation = rotationFor(t.type, need)!;
    if (i === 0) return { kind: "rotate", row: t.row, col: t.col, rotation };
    const prev = path[i - 1]!;
    const here = atSquare ? null : pos.slice(2);
    if (here === prev.key || (i === 1 && here === path[0]!.key)) return { kind: "rotate", row: t.row, col: t.col, rotation };
    return { kind: "walk", goal: prev.key };
  }
  return null;
}
