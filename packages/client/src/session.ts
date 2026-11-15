import {
  RULES_VERSION, applyAction, createGame,
  type Action, type Actor, type Archetype, type GameConfig, type GameState,
} from "@firetop/engine";

/**
 * A local hot-seat session: the setup plus every accepted action. The game
 * state is always reproducible by replaying the actions from the setup, which
 * is how undo and load work (the engine is deterministic per seed).
 */

export interface Seat {
  id: string;
  name: string;
  archetype: Archetype;
  bot: boolean;
}

export interface SessionSetup {
  seed: number;
  seats: Seat[];
  config: Partial<GameConfig>;
  /** When the game was started (ISO time); names autosave files. */
  startedAt?: string;
}

export interface LoggedAction {
  actor: Actor;
  action: Action;
}

export interface Session {
  setup: SessionSetup;
  actions: LoggedAction[];
  state: GameState;
}

export const SAVE_FORMAT = "firetop-local/1";

export interface SavedGame {
  format: typeof SAVE_FORMAT;
  /** Engine RULES_VERSION the game was played under. Older saves lack it (= 1). */
  rulesVersion: number;
  /** Git commit of the build that wrote the save, when known. */
  commit?: string;
  savedAt?: string;
  setup: SessionSetup;
  actions: LoggedAction[];
}

export type SessionResult = { ok: true; session: Session } | { ok: false; error: string };

export function startSession(setup: SessionSetup): Session {
  const state = createGame({
    seed: setup.seed,
    players: setup.seats.map(({ id, name, archetype }) => ({ id, name, archetype })),
    config: setup.config,
  });
  return { setup, actions: [], state };
}

export function act(session: Session, actor: Actor, action: Action): SessionResult {
  const r = applyAction(session.state, actor, action);
  if (!r.ok) return r;
  return { ok: true, session: { ...session, actions: [...session.actions, { actor, action }], state: r.state } };
}

/** Rebuild a session from its setup and a list of actions. Throws if an action is rejected. */
export function replay(setup: SessionSetup, actions: readonly LoggedAction[]): Session {
  let s = startSession(setup);
  actions.forEach(({ actor, action }, i) => {
    const r = act(s, actor, action);
    if (!r.ok) throw new Error(`action ${i + 1} (${action.type} by ${actor}) was rejected: ${r.error}`);
    s = r.session;
  });
  return s;
}

/** Undo the last action. */
export function undo(session: Session): Session {
  if (session.actions.length === 0) return session;
  return replay(session.setup, session.actions.slice(0, -1));
}

/**
 * Undo back to before the most recent action by a human seat, also removing
 * the bot and system actions that came after it.
 */
export function undoHumanTurn(session: Session): Session {
  const humans = new Set(session.setup.seats.filter((s) => !s.bot).map((s) => s.id));
  const actions = [...session.actions];
  while (actions.length) {
    const last = actions.pop()!;
    if (humans.has(last.actor) && last.action.type !== "setSettings") break;
  }
  return replay(session.setup, actions);
}

export function toSave(session: Session, meta: { commit?: string; savedAt?: string } = {}): SavedGame {
  return { format: SAVE_FORMAT, rulesVersion: RULES_VERSION, ...meta, setup: session.setup, actions: session.actions };
}

/**
 * Rebuild a saved game. Saves from a different RULES_VERSION are refused: even
 * if their actions still happened to be legal, the game would play out
 * differently from the one that was recorded.
 */
export function fromSave(data: unknown): Session {
  const saved = data as Partial<SavedGame>;
  if (saved?.format !== SAVE_FORMAT || !saved.setup || !Array.isArray(saved.actions)) {
    throw new Error(`not a ${SAVE_FORMAT} save file`);
  }
  const version = saved.rulesVersion ?? 1;
  if (version !== RULES_VERSION) {
    const at = saved.commit ? ` (commit ${saved.commit})` : "";
    throw new Error(`this game was played under rules v${version}${at}; the current rules are v${RULES_VERSION}. Check out that version to replay it.`);
  }
  return replay(saved.setup, saved.actions);
}

/** File-name-safe id for a session, from its start time and seed. */
export function sessionName(setup: SessionSetup): string {
  const t = (setup.startedAt ?? "unknown").replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `${t}-seed${setup.seed}`;
}

export interface GameStats {
  turn: number;
  turnsPerPlayer: number;
  actions: number;
  defeats: number;
  wizardFights: number;
  pvpFights: number;
  wrongGuesses: number;
  keysFound: number;
}

export function stats(session: Session): GameStats {
  const s = session.state;
  const count = (t: string) => s.log.filter((e) => e.type === t).length;
  return {
    turn: s.turn,
    turnsPerPlayer: Math.round((10 * s.turn) / s.players.length) / 10,
    actions: session.actions.length,
    defeats: count("defeat"),
    wizardFights: count("wizard"),
    pvpFights: count("pvp"),
    wrongGuesses: s.guesses.length,
    keysFound: s.log.filter((e) => /found key|took key \d/.test(e.text) && e.type !== "pvp").length,
  };
}
