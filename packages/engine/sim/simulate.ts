/**
 * Balance simulation: npm run sim -- [gamesPerSetup]
 * Plays scripted bots against each other and prints game length and win rates.
 */
import type { Archetype } from "../src/index.js";
import { simulate, type SimResult } from "./run.js";

const games = Number(process.argv[2] ?? 500);
const ARCH: Archetype[] = ["warrior", "survivor", "lucky"];

function pct(n: number, d: number) {
  return d ? `${((100 * n) / d).toFixed(1)}%` : "-";
}
function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

function summarize(label: string, results: SimResult[]) {
  const done = results.filter((r) => r.finished);
  const turns = done.map((r) => r.turnsPerPlayer);
  const avg = (f: (r: SimResult) => number) => (done.reduce((a, r) => a + f(r), 0) / (done.length || 1)).toFixed(1);
  console.log(
    `${label.padEnd(22)} finished ${pct(done.length, results.length).padStart(6)} | turns/player median ${quantile(turns, 0.5).toFixed(0).padStart(3)}, p90 ${quantile(turns, 0.9).toFixed(0).padStart(3)} | wrong guesses ${avg((r) => r.wrongGuesses)} | wizard fights ${avg((r) => r.wizardFights)} | defeats ${avg((r) => r.defeats)} | pvp ${avg((r) => r.pvpFights)}`,
  );
}

let seed = 1;
console.log(`\n== Game length (${games} games each, random archetypes) ==`);
for (const n of [2, 3, 4]) {
  const results: SimResult[] = [];
  for (let g = 0; g < games; g++) {
    const arch = Array.from({ length: n }, (_, i) => ARCH[(g * 7 + i * 3 + n) % 3]!);
    results.push(simulate(seed++, arch));
  }
  summarize(`${n} players`, results);
}

console.log(`\n== Archetype head-to-head (2 players, ${games} games each, seats alternated) ==`);
for (let i = 0; i < ARCH.length; i++) {
  for (let j = i + 1; j < ARCH.length; j++) {
    const a = ARCH[i]!, b = ARCH[j]!;
    let winsA = 0, winsB = 0;
    for (let g = 0; g < games; g++) {
      const seats: Archetype[] = g % 2 === 0 ? [a, b] : [b, a];
      const r = simulate(seed++, seats);
      if (r.winnerArchetype === a) winsA++;
      else if (r.winnerArchetype === b) winsB++;
    }
    console.log(`${a.padEnd(9)} vs ${b.padEnd(9)} ${pct(winsA, games).padStart(6)} : ${pct(winsB, games).padStart(6)}`);
  }
}

console.log(`\n== Seat advantage (2 players, same archetype) ==`);
let first = 0;
for (let g = 0; g < games; g++) if (simulate(seed++, ["warrior", "warrior"]).winner === "p1") first++;
console.log(`first player wins ${pct(first, games)}`);
