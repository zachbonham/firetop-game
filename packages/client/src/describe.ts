import { E, N, S, W, isMazeTile, type Encounter, type NodeId, type PublicEncounter } from "@firetop/engine";

const COLORS = ["#e4572e", "#2e9fd6", "#6bb33f", "#e9a81c"];

export function seatColor(idx: number): string {
  return COLORS[idx % COLORS.length]!;
}

/** Short room label. With `secret`, include hidden loot (god view). */
export function encounterLabel(e: Encounter | PublicEncounter, secret = false): string {
  switch (e.kind) {
    case "monster": {
      const loot = "loot" in e && e.loot !== null ? ` 🔑${e.loot}` : "";
      return `${e.name} ${e.skill}/${e.stamina}${secret || "loot" in e ? loot : ""}`;
    }
    case "treasure":
      return e.item === "key" ? `Key ${e.key}` : e.item === "provisions" ? "Provisions" : "Skill potion";
    case "trap":
      return `Trap -${e.damage}`;
    case "empty":
      return "Empty";
  }
}

export function describeNode(id: NodeId): string {
  if (id === "entrance") return "Entrance";
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
