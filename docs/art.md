# Art (M5)

The game ships with generated, original SVG art for everything, so it is fully playable with no
hand-made assets. Hand-made art is optional and drops into **art slots**. When a slot has a file, it
replaces the generated stand-in; when it doesn't, nothing breaks.

Keep all art original. Don't copy or imitate the look, characters, maps or text of *The Warlock
of Firetop Mountain* (the book, board game or any other edition).

## What is generated (no action needed)

All of this lives in `packages/client/src/art/icons.tsx`, `Board.tsx` and `styles.css`:
- the board: ground, mountain silhouette, corridors, room chambers, flagstone path squares, the
  Entrance, Camp, Maze square and Lair, and the maze frame
- maze tiles: carved stone corridors; face-down tiles show a rune
- player tokens, coloured by seat
- icons for keys, every item, monsters, treasure, traps, the camp, gate, tower, skull, dice and
  crown
- card frames, one colour per card type: monster, treasure, trap, Warlock, duel, defeat,
  victory, secret
- archetype emblems, used as portraits until real ones exist: sword (Warrior), heart (Survivor),
  clover (Lucky)

## Art slots (provided by you)

Drop an image into `packages/client/src/assets/art/<folder>/<slug>.webp` (`.png` and `.jpg` also
work). It is picked up at build time, with no manifest or code change. A slug is the name in
lowercase with dashes ("Giant Spider" becomes `giant-spider`).

| Folder | Slugs | Where it shows | Suggested size |
|---|---|---|---|
| `portraits/` | `warrior`, `survivor`, `lucky` | Players panel (round crop) | 256×256, subject centred |
| `monsters/` | `goblin`, `giant-rat`, `orc`, `skeleton`, `zombie`, `giant-spider`, `ogre`, `troll`, `the-warlock` | Card art for monster and Warlock cards | 480×280 (landscape, about 12:7) |
| `locations/` | `r1` … `r10` (also `entrance`, `camp`, `maze`, `lair`, reserved for later) | Card art for treasure and trap rooms | 480×280 |

Notes:
- **Cropping:** cards crop images to fill (`object-fit: cover`), so keep the subject away from the edges.
- **Style:** the generated art uses dark, warm stone (#1a1612 to #6e665a) with brass (#b8a46a)
  and gold (#e0b84a) accents. Painted or ink-and-wash art in that range will sit well.
- **Monster names:** these come from `MONSTERS` in `packages/engine/src/config.ts`; the Warlock's
  name comes from `config.wizard.name`. Renaming a monster changes its slug.
- **File size:** keep each file under ~150 KB (webp at quality 80 is plenty). Everything in these
  folders is bundled into the app.
