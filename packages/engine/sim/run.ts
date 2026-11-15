import {
  applyAction, botAction, checkInvariants, createGame, playerView,
  type Archetype, type GameConfig, type GameState,
} from "../src/index.js";

export interface SimResult {
  finished: boolean;
  winner: string | null;
  winnerArchetype: Archetype | null;
  turnsPerPlayer: number;
  actions: number;
  wrongGuesses: number;
  wizardFights: number;
  wizardWins: number;
  defeats: number;
  pvpFights: number;
  final: GameState;
}

export interface SimOptions {
  maxActions?: number;
  /** Rule overrides, as passed to createGame. */
  config?: Partial<GameConfig>;
}

export function simulate(seed: number, archetypes: Archetype[], opts: SimOptions = {}): SimResult {
  const maxActions = opts.maxActions ?? 5000;
  let s = createGame({
    seed,
    ...(opts.config ? { config: opts.config } : {}),
    players: archetypes.map((a, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, archetype: a })),
  });
  let actions = 0;
  while (s.phase !== "finished" && actions < maxActions) {
    const actor = s.players[s.currentIndex]!.id;
    const action = botAction(playerView(s, actor));
    const res = applyAction(s, actor, action);
    if (!res.ok) throw new Error(`seed ${seed}: bot action ${JSON.stringify(action)} rejected: ${res.error}`);
    s = res.state;
    actions++;
    const broken = checkInvariants(s);
    if (broken.length) throw new Error(`seed ${seed} after ${JSON.stringify(action)}: ${broken.join("; ")}`);
  }
  const count = (t: string) => s.log.filter((e) => e.type === t).length;
  const winner = s.players.find((p) => p.id === s.winner) ?? null;
  return {
    finished: s.phase === "finished",
    winner: s.winner,
    winnerArchetype: winner?.archetype ?? null,
    turnsPerPlayer: s.turn / s.players.length,
    actions,
    wrongGuesses: s.guesses.length,
    wizardFights: count("wizard"),
    wizardWins: s.log.filter((e) => e.type === "wizard" && e.text.includes("defeated The")).length,
    defeats: count("defeat"),
    pvpFights: count("pvp"),
    final: s,
  };
}
