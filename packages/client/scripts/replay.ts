/**
 * Replay a saved or autosaved game and print everything about it:
 *   npm run replay -- playtests/autosave/<file>.json [--all]
 * Shows the secrets (combination, room contents), final players, stats and
 * the full log including private entries. --all prints the action list too.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RULES_VERSION, checkInvariants } from "@firetop/engine";
import { fromSave, stats, type SavedGame } from "../src/session.js";
import { encounterLabel } from "../src/describe.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run replay -- <save.json> [--all]");
  process.exit(1);
}
const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
const raw = JSON.parse(readFileSync(path, "utf8")) as SavedGame;
console.log(`${path}\nrules v${raw.rulesVersion ?? 1} (current v${RULES_VERSION}), commit ${raw.commit ?? "?"}, saved ${raw.savedAt ?? "?"}`);

const session = fromSave(raw);
const s = session.state;
const name = (id: string | undefined) => s.players.find((p) => p.id === id)?.name ?? id ?? "";

console.log(`\nSeed ${s.seed} · config overrides ${JSON.stringify(session.setup.config)}`);
console.log(`Combination: ${s.combination.join(", ")}`);
console.log(`Phase: ${s.phase}${s.winner ? ` · winner ${name(s.winner)}` : ""} · turn ${s.turn}`);
console.log("\nRooms:");
for (const [id, r] of Object.entries(s.rooms)) {
  console.log(`  ${id.padEnd(4)} ${encounterLabel(r.encounter).padEnd(28)} ${r.cleared ? "cleared" : r.revealed ? "revealed" : ""}`);
}
console.log("\nPlayers:");
session.setup.seats.forEach((seat, i) => {
  const p = s.players[i]!;
  console.log(
    `  ${p.name} (${p.archetype}${seat.bot ? ", bot" : ""}): Skill ${p.skill}, Stamina ${p.stamina}/${p.maxStamina}, Luck ${p.luck}, ` +
      `keys [${p.keys.join(",")}], items [${(p.items ?? []).join(",")}], at ${p.pos}, ${p.status}`,
  );
});
console.log(`\nStats: ${JSON.stringify(stats(session))}`);
const broken = checkInvariants(s);
if (broken.length) console.log(`\nBROKEN INVARIANTS: ${broken.join("; ")}`);

console.log("\nLog:");
for (const e of s.log) console.log(`  t${String(e.turn).padEnd(4)} ${e.text}${e.privateTo ? `  [private to ${name(e.privateTo)}]` : ""}`);

if (args.includes("--all")) {
  console.log("\nActions:");
  session.actions.forEach((a, i) => console.log(`  ${String(i + 1).padStart(4)} ${name(a.actor) || a.actor}: ${JSON.stringify(a.action)}`));
}
