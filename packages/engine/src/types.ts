export type Archetype = "warrior" | "survivor" | "lucky";

/** A board square id (e.g. "r3.1", "p:r1-r3.0") or a maze tile id ("m:<row>:<col>"). */
export type NodeId = string;

export type LocationId =
  | "entrance"
  | "r1" | "r2" | "r3" | "r4" | "r5" | "r6" | "r7" | "r8" | "r9" | "r10"
  | "camp"
  | "maze"
  | "lair";

/**
 * Treasure items. Potions take effect when found; the rest are carried.
 * provisions and scroll are used with the useItem action; sword, shield and
 * amulet work automatically.
 */
export type ItemId = "provisions" | "skillPotion" | "luckPotion" | "sword" | "shield" | "amulet" | "scroll";

export type TileType = "straight" | "corner" | "tee" | "cross" | "dead";

export interface MonsterCard {
  name: string;
  skill: number;
  stamina: number;
}

export interface ArchetypeStats {
  skill: number;
  stamina: number;
  luck: number;
}

export interface GameConfig {
  keyCount: number;
  comboSize: number;
  wizard: MonsterCard;
  restAmount: number;
  provisionsAmount: number;
  trapDamage: [number, number];
  wrongGuessDamage: number;
  combatDamage: number;
  maxMissedTurns: number;
  defaultFleeBelow: number;
  /** Starting stats per archetype (defaults to ARCHETYPES). */
  archetypes: Record<Archetype, ArchetypeStats>;
  roomMix: { monster: number; treasure: number; trap: number; empty: number };
  /** How many of each item go into the treasure deck; one is drawn per treasure room. */
  treasureDeck: Record<ItemId, number>;
  items: {
    skillPotion: number;
    luckPotion: number;
    /** Extra Skill against monsters and the wizard (not players). */
    swordSkill: number;
    /** Damage blocked per lost combat round (a lost round still costs at least 1). */
    shieldBlock: number;
  };
}

export interface PlayerSettings {
  /** Flee a fight once Stamina drops below this. 0 = never flee. */
  fleeBelow: number;
  /** Spend a Luck token to reroll automatically when losing a combat round. */
  autoLuck: boolean;
}

export interface Player {
  id: string;
  name: string;
  archetype: Archetype;
  skill: number;
  stamina: number;
  maxStamina: number;
  luck: number;
  keys: number[];
  pos: NodeId;
  status: "active" | "removed";
  skipNextTurn: boolean;
  /** Protected from player attacks until the start of this player's next turn. */
  protected: boolean;
  missedTurns: number;
  wizardBeaten: boolean;
  /** Carried items (public). */
  items: ItemId[];
  /** Has entered the camp: defeats wake you there instead of at the entrance. */
  campReached: boolean;
  /** PRIVATE: rooms this player has looked into with a scroll. */
  peeks: string[];
  /** This player's private view of the maze: "row:col" -> rotation (0-3). */
  maze: Record<string, number>;
  settings: PlayerSettings;
}

export type Encounter =
  | { kind: "monster"; name: string; skill: number; stamina: number; loot: number | null }
  | { kind: "treasure"; item: ItemId; key: number | null }
  | { kind: "trap"; damage: number }
  | { kind: "empty" };

export interface RoomState {
  encounter: Encounter;
  revealed: boolean;
  cleared: boolean;
}

export interface ChestGuess {
  playerId: string;
  keys: number[];
  correct: number;
  turn: number;
}

export interface GameEvent {
  turn: number;
  type: string;
  text: string;
  playerId?: string;
  /** If set, only this player can see the event. */
  privateTo?: string;
}

/** roll -> move -> (orient, after flipping a maze tile) -> next player. */
export type Phase = "roll" | "move" | "orient" | "finished";

export interface PendingFlip {
  row: number;
  col: number;
  /** Side of the tile the player entered through; the chosen rotation must open here. */
  entrySide: number;
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  config: GameConfig;
  players: Player[];
  currentIndex: number;
  turn: number;
  phase: Phase;
  pendingRoll: number | null;
  /** Set while the current player chooses how to turn a tile they just flipped. */
  pendingFlip: PendingFlip | null;
  rooms: Record<string, RoomState>;
  /** SECRET: the keys that open the chest. */
  combination: number[];
  /** SECRET: tile types in row-major order (16 tiles). */
  mazeTiles: TileType[];
  /** Keys lying on a node after a defeat. */
  dropped: Record<NodeId, number[]>;
  guesses: ChestGuess[];
  winner: string | null;
  log: GameEvent[];
}

export type Action =
  | { type: "roll" }
  | { type: "move"; to: NodeId; attack?: string; stealKey?: number }
  | { type: "orientTile"; rotation: number }
  | { type: "rest" }
  /** Attack a player on your own square, instead of rolling. */
  | { type: "attack"; target: string; stealKey?: number }
  | { type: "guessChest"; keys: number[] }
  | { type: "leaveLair" }
  /** Re-turn a maze tile you revealed: the one you stand on or one next to it. Costs your turn. */
  | { type: "rotateTile"; row: number; col: number; rotation: number }
  | { type: "setSettings"; settings: Partial<PlayerSettings> }
  /** Use a carried item (provisions, or a scroll on a room). Free: does not end your turn. */
  | { type: "useItem"; item: ItemId; room?: string }
  | { type: "timeout" };

/** Who sends an action: a player id, or the server for timeouts. */
export type Actor = string | "system";

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };
