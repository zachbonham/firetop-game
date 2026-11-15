/**
 * Balance diagnostics: npm run diag -- [games] [--config overrides.json]
 * Where do archetypes win and lose? Per-archetype monster, wizard and PvP
 * results for 2-player head-to-heads, plus game timing.
 */
import { readFileSync } from "node:fs";
import type { Archetype, GameConfig } from "../src/index.js";
import { simulate } from "./run.js";

const args = process.argv.slice(2);
const configAt = args.indexOf("--config");
let config: Partial<GameConfig> | undefined;
if (configAt >= 0) {
  config = JSON.parse(readFileSync(args[configAt + 1]!, "utf8")) as Partial<GameConfig>;
  args.splice(configAt, 2);
}
const games = Number(args[0] ?? 50);
const ARCH: Archetype[] = ["warrior", "survivor", "lucky"];

type Tally = Record<string, number>;
const per: Record<Archetype, Tally> = { warrior: {}, survivor: {}, lucky: {} };
const bump = (a: Archetype, k: string, n = 1) => (per[a][k] = (per[a][k] ?? 0) + n);

let seed = 10_000;
const times: number[] = [];
const turns: number[] = [];
for (let i = 0; i < ARCH.length; i++) {
  for (let j = i + 1; j < ARCH.length; j++) {
    for (let g = 0; g < games; g++) {
      const seats: Archetype[] = g % 2 ? [ARCH[j]!, ARCH[i]!] : [ARCH[i]!, ARCH[j]!];
      const t0 = performance.now();
      const r = simulate(seed++, seats, config ? { config } : {});
      times.push(performance.now() - t0);
      turns.push(r.turnsPerPlayer);
      const arch = (id: string | undefined) => r.final.players.find((p) => p.id === id)?.archetype;
      const byName = (name: string) => r.final.players.find((p) => name.startsWith(p.name + " "))?.archetype;
      for (const p of r.final.players) bump(p.archetype, "games");
      if (r.winnerArchetype) bump(r.winnerArchetype, "wins");
      if (!r.finished) for (const p of r.final.players) bump(p.archetype, "unfinished");
      for (const e of r.final.log) {
        const a = arch(e.playerId);
        if (!a) continue;
        if (e.type === "combat") bump(a, e.text.includes("defeated the") ? "monsterWin" : e.text.includes("fled") ? "monsterFlee" : "monsterLoss");
        if (e.type === "wizard") bump(a, e.text.includes("defeated The") ? "wizWin" : e.text.includes("fled") ? "wizFlee" : "wizLoss");
        if (e.type === "pvp") {
          bump(a, "pvpAttack");
          const w = byName(e.text);
          if (w) bump(w, "pvpWon");
        }
        if (e.type === "defeat") bump(a, "defeat");
        if (e.type === "guess") bump(a, "wrongGuess");
        if (e.type === "rest") bump(a, "rest");
        if (e.type === "roll") bump(a, "roll");
      }
    }
  }
}
const cols = ["games", "wins", "unfinished", "monsterWin", "monsterFlee", "monsterLoss", "wizWin", "wizFlee", "wizLoss", "pvpAttack", "pvpWon", "defeat", "wrongGuess", "rest", "roll"];
console.log("per game:".padEnd(10) + cols.slice(1).map((c) => c.padStart(11)).join(""));
for (const a of ARCH) {
  const t = per[a];
  const n = t.games ?? 1;
  console.log(a.padEnd(10) + cols.slice(1).map((c) => ((t[c] ?? 0) / n).toFixed(2).padStart(11)).join(""));
}
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))]!;
console.log(`ms/game median ${q(times, 0.5).toFixed(0)} p90 ${q(times, 0.9).toFixed(0)} max ${q(times, 1).toFixed(0)}; turns/player median ${q(turns, 0.5)} p90 ${q(turns, 0.9)} max ${q(turns, 1)}`);
