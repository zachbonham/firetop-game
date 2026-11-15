import type { Archetype, ArchetypeStats, GameConfig, MonsterCard, TileType } from "./types.js";

/**
 * Bump whenever a change makes an old action log replay differently (rules,
 * setup randomization, board). Saved games record it and refuse to load under
 * another version.
 *   1: M1/M2 rules.
 *   2: no empty rooms, keys separate from treasure items, carried items, camp.
 *   3: balance pass: Warlock 9/12, Warrior Skill 9, Survivor and Lucky rest
 *      abilities, fleeing costs Stamina, keys lost in the lair or maze drop
 *      at the maze entrance.
 */
export const RULES_VERSION: number = 3;

/**
 * Tuned with `npm run sim` / `npm run diag` (rules v3): each archetype wins
 * about a third of head-to-heads.
 *   warrior: best fighter.
 *   survivor: deep Stamina and rests heal more.
 *   lucky: rerolls lost rounds, and rests win Luck back.
 */
export const ARCHETYPES: Record<Archetype, ArchetypeStats> = {
  warrior: { skill: 9, stamina: 14, luck: 1 },
  survivor: { skill: 8, stamina: 20, luck: 2, restBonus: 2 },
  lucky: { skill: 8, stamina: 14, luck: 5, luckOnRest: 2 },
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
  wizard: { name: "The Warlock", skill: 9, stamina: 12 },
  restAmount: 4,
  provisionsAmount: 4,
  trapDamage: [1, 3],
  wrongGuessDamage: 3,
  combatDamage: 2,
  maxMissedTurns: 3,
  defaultFleeBelow: 4,
  fleeDamage: 2,
  archetypes: ARCHETYPES,
  /** Room encounter mix for the 10 rooms. Keys go to monster/treasure rooms only (with or as well as an item). */
  roomMix: { monster: 5, treasure: 4, trap: 1, empty: 0 },
  treasureDeck: { provisions: 2, skillPotion: 1, luckPotion: 1, sword: 1, shield: 1, amulet: 1, scroll: 1 },
  items: { skillPotion: 1, luckPotion: 2, swordSkill: 1, shieldBlock: 1 },
};
