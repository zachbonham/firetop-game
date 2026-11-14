import { ARCHETYPES, DEFAULT_CONFIG, MONSTERS } from "./config.js";
import { BOARD, ENTRANCE } from "./board.js";
import { dealMaze } from "./maze.js";
import { Rng } from "./rng.js";
import type { Archetype, Encounter, GameConfig, GameState, Player, RoomState } from "./types.js";

export interface NewPlayer {
  id: string;
  name: string;
  archetype: Archetype;
}

export interface NewGameOptions {
  seed: number;
  players: NewPlayer[];
  config?: Partial<GameConfig>;
}

type RoomKind = "monster" | "treasure" | "trap" | "empty";

/**
 * Create a game: randomize the chest combination, each room's encounter, where
 * the 7 keys are hidden, and the maze deal. Everything is driven by `seed`.
 */
export function createGame(opts: NewGameOptions): GameState {
  if (opts.players.length < 2 || opts.players.length > 4) throw new Error("2-4 players required");
  const ids = new Set(opts.players.map((p) => p.id));
  if (ids.size !== opts.players.length) throw new Error("player ids must be unique");

  const config: GameConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const rng = new Rng(opts.seed);

  const keys = Array.from({ length: config.keyCount }, (_, i) => i + 1);
  const combination = rng.shuffle(keys).slice(0, config.comboSize).sort((a, b) => a - b);

  const mix = config.roomMix;
  const kinds: RoomKind[] = [
    ...Array<RoomKind>(mix.monster).fill("monster"),
    ...Array<RoomKind>(mix.treasure).fill("treasure"),
    ...Array<RoomKind>(mix.trap).fill("trap"),
    ...Array<RoomKind>(mix.empty).fill("empty"),
  ];
  if (kinds.length !== BOARD.rooms.length) throw new Error("room mix must cover every room");
  const roomKinds = rng.shuffle(kinds);

  const keyRooms = BOARD.rooms.filter((_, i) => roomKinds[i] === "monster" || roomKinds[i] === "treasure");
  if (keyRooms.length < config.keyCount) throw new Error("not enough monster/treasure rooms for keys");
  const keyRoomOrder = rng.shuffle(keyRooms).slice(0, config.keyCount);
  const keyByRoom = new Map<string, number>();
  rng.shuffle(keys).forEach((k, i) => keyByRoom.set(keyRoomOrder[i]!, k));

  const monsters = rng.shuffle(MONSTERS);
  const rooms: Record<string, RoomState> = {};
  BOARD.rooms.forEach((room, i) => {
    const kind = roomKinds[i]!;
    const key = keyByRoom.get(room) ?? null;
    let encounter: Encounter;
    if (kind === "monster") {
      const m = monsters.pop()!;
      encounter = { kind: "monster", name: m.name, skill: m.skill, stamina: m.stamina, loot: key };
    } else if (kind === "treasure") {
      encounter = key !== null
        ? { kind: "treasure", item: "key", key }
        : { kind: "treasure", item: rng.pick(["provisions", "skill"] as const) };
    } else if (kind === "trap") {
      const [lo, hi] = config.trapDamage;
      encounter = { kind: "trap", damage: lo + rng.int(hi - lo + 1) };
    } else {
      encounter = { kind: "empty" };
    }
    rooms[room] = { encounter, revealed: false, cleared: false };
  });

  const mazeTiles = dealMaze(rng);

  const players: Player[] = opts.players.map((np) => {
    const stats = ARCHETYPES[np.archetype];
    return {
      id: np.id,
      name: np.name,
      archetype: np.archetype,
      skill: stats.skill,
      stamina: stats.stamina,
      maxStamina: stats.stamina,
      luck: stats.luck,
      keys: [],
      pos: ENTRANCE,
      status: "active",
      skipNextTurn: false,
      protected: false,
      missedTurns: 0,
      wizardBeaten: false,
      maze: {},
      settings: { fleeBelow: config.defaultFleeBelow, autoLuck: true },
    };
  });

  return {
    version: 1,
    seed: opts.seed,
    rng: rng.state,
    config,
    players,
    currentIndex: 0,
    turn: 1,
    phase: "roll",
    pendingRoll: null,
    pendingFlip: null,
    rooms,
    combination,
    mazeTiles,
    dropped: {},
    guesses: [],
    winner: null,
    log: [{ turn: 1, type: "start", text: `Game started with ${players.length} players.` }],
  };
}
