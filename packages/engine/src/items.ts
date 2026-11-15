import type { Encounter, ItemId } from "./types.js";

export const ITEM_NAMES: Record<ItemId, string> = {
  provisions: "Provisions",
  skillPotion: "Potion of Skill",
  luckPotion: "Potion of Luck",
  sword: "Enchanted Sword",
  shield: "Shield",
  amulet: "Amulet of Return",
  scroll: "Scroll of Seeing",
};

/** Items that take effect the moment they are found instead of being carried. */
export const INSTANT_ITEMS: readonly ItemId[] = ["skillPotion", "luckPotion"];

/** Items used with the useItem action. The others work automatically. */
export const USABLE_ITEMS: readonly ItemId[] = ["provisions", "scroll"];

/** Full description of a room's contents (for private scroll results and logs). */
export function describeEncounter(e: Encounter): string {
  switch (e.kind) {
    case "monster":
      return `a ${e.name} (Skill ${e.skill}, Stamina ${e.stamina})${e.loot !== null ? ` guarding key ${e.loot}` : ""}`;
    case "treasure":
      return `${ITEM_NAMES[e.item]}${e.key !== null ? ` and key ${e.key}` : ""}`;
    case "trap":
      return `a trap (-${e.damage} Stamina)`;
    case "empty":
      return "nothing";
  }
}
