import type { Archetype, ArchetypeStats, GameConfig, MonsterCard, TileType } from "./types.js";

/** Placeholder stats; tune with `npm run sim`. */
export const ARCHETYPES: Record<Archetype, ArchetypeStats> = {
  warrior: { skill: 10, stamina: 14, luck: 1 },
  survivor: { skill: 8, stamina: 20, luck: 2 },
  lucky: { skill: 8, stamina: 14, luck: 4 },
};

export const MONSTERS: readonly MonsterCard[] = [
  { name: "Goblin", skill: 5, stamina: 5 },
  { name: "Giant Rat", skill: 5, stamina: 4 },
  { name: "Orc", skill: 6, stamina: 6 },
  { name: "Skeleton", skill: 6, stamina: 6 },
  { name: "Zombie", skill: 6, stamina: 7 },
  { name: "Giant Spider", skill: 7, stamina: 8 },
  { name: "Ogre", skill: 8, stamina: 9 },
  { name: "Troll", skill: 8, stamina: 10 },
];

/** How many of each maze tile go into the 16-tile deal. */
export const MAZE_DEAL: Record<TileType, number> = {
  cross: 2,
  tee: 5,
  straight: 3,
  corner: 4,
  dead: 2,
};

export const DEFAULT_CONFIG: GameConfig = {
  keyCount: 7,
  comboSize: 3,
  wizard: { name: "The Warlock", skill: 10, stamina: 14 },
  restAmount: 4,
  provisionsAmount: 4,
  trapDamage: [1, 3],
  wrongGuessDamage: 3,
  combatDamage: 2,
  maxMissedTurns: 3,
  defaultFleeBelow: 4,
  archetypes: ARCHETYPES,
  /** Room encounter mix for the 10 rooms. Keys go to monster/treasure rooms only. */
  roomMix: { monster: 5, treasure: 3, trap: 1, empty: 1 },
};
