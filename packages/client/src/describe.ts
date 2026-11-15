import {
  E, ITEM_NAMES, N, S, W, isMazeTile,
  type Encounter, type NodeId, type PeekedEncounter, type PublicEncounter,
} from "@firetop/engine";

const COLORS = ["#e4572e", "#2e9fd6", "#6bb33f", "#e9a81c"];

export function seatColor(idx: number): string {
  return COLORS[idx % COLORS.length]!;
}

/** Short room label. Shows a monster's key whenever the encounter carries it (god view, scroll peeks). */
export function encounterLabel(e: Encounter | PublicEncounter | PeekedEncounter): string {
  switch (e.kind) {
    case "monster": {
      const key = "loot" in e ? e.loot : "guardsKey" in e ? e.guardsKey : null;
      return `${e.name} ${e.skill}/${e.stamina}${key !== null ? ` 🔑${key}` : ""}`;
    }
    case "treasure":
      return `${ITEM_NAMES[e.item]}${e.key !== null ? ` + 🔑${e.key}` : ""}`;
    case "trap":
      return `Trap -${e.damage}`;
    case "empty":
      return "Empty";
  }
}

export function describeNode(id: NodeId): string {
  if (id === "entrance") return "Entrance";
  if (id === "camp") return "Camp";
  if (id === "maze") return "Maze square";
  if (id === "lair") return "Lair";
  if (id === "maze:hidden") return "in the maze";
  if (isMazeTile(id)) {
    const [, r, c] = id.split(":");
    return `maze tile ${r},${c}`;
  }
  if (id.startsWith("p:")) {
    const [route, i] = id.slice(2).split(".");
    return `path ${route!.replace("-", "→")} #${Number(i) + 1}`;
  }
  const [room] = id.split(".");
  return `room ${room!.toUpperCase()}`;
}

export function sideName(side: number): string {
  return side === N ? "north" : side === E ? "east" : side === S ? "south" : side === W ? "west" : "?";
}
