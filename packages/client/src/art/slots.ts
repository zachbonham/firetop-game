/**
 * Art slots: hand-made art the project owner drops in, with generated SVG
 * stand-ins until then. Put an image at
 *   src/assets/art/portraits/<archetype>.(webp|png|jpg)    warrior, survivor, lucky
 *   src/assets/art/monsters/<monster-slug>.(webp|png|jpg)  e.g. giant-rat, the-warlock
 *   src/assets/art/locations/<location>.(webp|png|jpg)     entrance, r1..r10, camp, maze, lair
 * and it is picked up at build time (no manifest to edit, no 404s for missing
 * files). See docs/art.md for sizes and style notes.
 */
const files = import.meta.glob("../assets/art/*/*.{webp,png,jpg,jpeg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export type ArtKind = "portraits" | "monsters" | "locations";

const byKey = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
  const m = /\/art\/([^/]+)\/([^/.]+)\.\w+$/.exec(path);
  if (m) byKey.set(`${m[1]}/${m[2]!.toLowerCase()}`, url);
}

/** "Giant Spider" -> "giant-spider". */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** URL of the provided art for this slot, or null to use the generated stand-in. */
export function artUrl(kind: ArtKind, name: string): string | null {
  return byKey.get(`${kind}/${slug(name)}`) ?? null;
}
