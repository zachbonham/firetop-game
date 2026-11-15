import { useEffect, useMemo, useRef, useState } from "react";
import {
  ITEM_NAMES, botAction, candidateCombos, playerView,
  type Action, type Actor, type GameState, type NodeId, type PlayerView,
} from "@firetop/engine";
import { ActionPanel, attackable } from "./ActionPanel.js";
import { Board } from "./Board.js";
import { CardPopup, Portrait, cardsBetween, roomCard, type CardData } from "./Cards.js";
import { describeNode, encounterLabel, seatColor } from "./describe.js";
import { saveData, type AutosaveStatus } from "./autosave.js";
import { downloadJson } from "./files.js";
import { act, sessionName, stats, undo, undoHumanTurn, type Session } from "./session.js";

type Speed = "paused" | "slow" | "normal" | "fast" | "instant";
const DELAY: Record<Exclude<Speed, "paused" | "instant">, number> = { slow: 900, normal: 350, fast: 40 };
const MAX_INSTANT = 5000;

interface Props {
  session: Session;
  setSession: (s: Session) => void;
  saveStatus: AutosaveStatus;
  onNewGame: () => void;
}

export function Game({ session, setSession, saveStatus, onNewGame }: Props) {
  const state = session.state;
  const seats = session.setup.seats;
  const isBot = (id: string) => seats.find((s) => s.id === id)?.bot ?? false;
  const humans = seats.filter((s) => !s.bot);
  const current = state.players[state.currentIndex]!;
  const currentIsHuman = !isBot(current.id) && current.status === "active";
  const finished = state.phase === "finished";

  const [speed, setSpeed] = useState<Speed>("normal");
  const [god, setGod] = useState(false);
  const [passScreen, setPassScreen] = useState(true);
  const [revealedTo, setRevealedTo] = useState<string | null>(null);
  const [lastViewer, setLastViewer] = useState<string | null>(humans[0]?.id ?? null);
  const [selectedTo, setSelectedTo] = useState<NodeId | null>(null);
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCards, setShowCards] = useState(true);
  const [cards, setCards] = useState<CardData[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [zoomed, setZoomed] = useState(true);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedTo(null);
    setSelectedTile(null);
  }, [session]);

  useEffect(() => {
    if (currentIsHuman) setLastViewer(current.id);
  }, [current.id, currentIsHuman]);

  const covered = !finished && currentIsHuman && passScreen && humans.length > 1 && revealedTo !== current.id && !god;
  const viewerId = currentIsHuman ? current.id : lastViewer;
  const view: PlayerView = useMemo(() => playerView(state, covered ? null : viewerId), [state, viewerId, covered]);
  const actorView = currentIsHuman && !covered ? playerView(state, current.id) : null;

  const apply = (actor: Actor, action: Action): boolean => {
    const r = act(session, actor, action);
    if (!r.ok) {
      setError(`${action.type}: ${r.error}`);
      return false;
    }
    setError(null);
    if (showCards && actor !== "system" && !isBot(actor)) {
      const shown = cardsBetween(playerView(state, actor), playerView(r.session.state, actor));
      if (shown.length) setCards(shown);
    }
    setSession(r.session);
    return true;
  };

  const botStep = () => {
    if (finished) return;
    const id = current.id;
    apply(id, botAction(playerView(state, id)));
  };

  // Drive bot seats.
  useEffect(() => {
    if (finished || currentIsHuman || speed === "paused" || error) return;
    if (speed === "instant") {
      let s = session;
      for (let i = 0; i < MAX_INSTANT; i++) {
        const st = s.state;
        const p = st.players[st.currentIndex]!;
        if (st.phase === "finished" || !isBot(p.id)) break;
        const r = act(s, p.id, botAction(playerView(st, p.id)));
        if (!r.ok) {
          setError(`bot ${p.name}: ${r.error}`);
          break;
        }
        s = r.session;
      }
      setSession(s);
      return;
    }
    const t = setTimeout(botStep, DELAY[speed]);
    return () => clearTimeout(t);
  });

  const moveTargets = new Set(actorView?.me?.moveOptions.map((o) => o.to) ?? []);

  // On small screens the board is wider than the screen: keep the action in view.
  const focusNode = actorView?.me?.pos ?? (current.pos === "maze:hidden" ? null : current.pos);
  useEffect(() => {
    const centre = () => {
      const wrap = boardRef.current;
      if (!wrap || wrap.scrollWidth <= wrap.clientWidth || !focusNode) return;
      const el = wrap.querySelector(`[data-node="${CSS.escape(focusNode)}"]`);
      if (!el) return;
      const w = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
      wrap.scrollTo({ left: wrap.scrollLeft + r.left + r.width / 2 - (w.left + w.width / 2), behavior: "smooth" });
    };
    centre();
    window.addEventListener("resize", centre);
    return () => window.removeEventListener("resize", centre);
  }, [focusNode, zoomed, covered]);

  const onNodeClick = (id: NodeId) => {
    if (!actorView || !moveTargets.has(id)) return;
    if (attackable(actorView, id).length === 0) apply(current.id, { type: "move", to: id });
    else setSelectedTo(id);
  };
  const onRoomClick = (room: string) => {
    const real = state.rooms[room];
    if (!real) return;
    if (god) return setCards([roomCard(room, real.encounter, { cleared: real.cleared, secret: !real.revealed })]);
    const pub = view.rooms[room];
    if (pub?.revealed && pub.encounter) return setCards([roomCard(room, pub.encounter, { cleared: pub.cleared })]);
    const peek = view.me?.peeks[room];
    if (peek) setCards([roomCard(room, peek, { secret: true })]);
  };
  const onTileClick = (row: number, col: number) => {
    if (actorView && state.phase === "roll") setSelectedTile(`${row}:${col}`);
  };

  const st = stats(session);
  const winner = state.players.find((p) => p.id === state.winner);

  return (
    <div className="game">
      <header className="topbar">
        <b>Turn {state.turn}</b>
        <span>
          <span className="swatch" style={{ background: seatColor(state.currentIndex) }} /> {current.name}
          {isBot(current.id) ? " (bot)" : ""} · {state.phase}
          {state.pendingRoll !== null ? ` · rolled ${state.pendingRoll}` : ""}
        </span>
        <span className="spacer" />
        <button className="tools-toggle" onClick={() => setToolsOpen(!toolsOpen)} aria-expanded={toolsOpen}>☰ Tools</button>
        <div className={`tools${toolsOpen ? " open" : ""}`}>
        <label>
          Bots{" "}
          <select value={speed} onChange={(e) => { setSpeed(e.target.value as Speed); setError(null); }}>
            <option value="paused">paused</option>
            <option value="slow">slow</option>
            <option value="normal">normal</option>
            <option value="fast">fast</option>
            <option value="instant">instant</option>
          </select>
        </label>
        {!currentIsHuman && !finished && <button onClick={botStep}>Step bot</button>}
        <label title="Show everything: hidden rooms, loot, the combination, the maze deal, positions in the maze">
          <input type="checkbox" checked={god} onChange={(e) => setGod(e.target.checked)} /> God view
        </label>
        <label title="Show a card when a human player reveals a room, fights or finds something">
          <input type="checkbox" checked={showCards} onChange={(e) => setShowCards(e.target.checked)} /> Cards
        </label>
        <label title="Hide the board between human players' turns">
          <input type="checkbox" checked={passScreen} onChange={(e) => setPassScreen(e.target.checked)} /> Pass screen
        </label>
        <button onClick={() => setSession(undo(session))} disabled={session.actions.length === 0}>Undo</button>
        <button onClick={() => setSession(undoHumanTurn(session))} disabled={session.actions.length === 0} title="Undo back to before the last human action (also removes bot moves after it)">
          Undo to human
        </button>
        <button onClick={() => apply("system", { type: "timeout" })} disabled={finished} title="Simulate the server timing out this turn">⏱ Timeout</button>
        <button onClick={() => downloadJson(`firetop-${sessionName(session.setup)}-t${state.turn}.json`, saveData(session))} title="Download a copy (games are also autosaved)">Save</button>
        <button onClick={onNewGame}>New game</button>
        </div>
      </header>

      {cards.length > 0 && <CardPopup cards={cards} onClose={() => setCards([])} />}
      {error && <div className="error banner" onClick={() => setError(null)}>{error} <small>(click to dismiss{speed !== "paused" ? "; bots wait until dismissed" : ""})</small></div>}
      {winner && <div className="win banner">🏆 {winner.name} wins on turn {state.turn} ({st.turnsPerPlayer} turns per player).</div>}

      <div className="main">
        <div className="board-col">
        <div className={`board-wrap${zoomed ? " zoomed" : ""}`} ref={boardRef}>
          <button className="zoom-toggle" onClick={() => setZoomed(!zoomed)} title="Phone only: zoomed and scrollable, or the whole board">{zoomed ? "Whole board" : "Zoom in"}</button>
          {covered ? (
            <div className="cover">
              <p>Pass the device to</p>
              <h2 style={{ color: seatColor(state.currentIndex) }}>{current.name}</h2>
              <button className="primary" onClick={() => setRevealedTo(current.id)}>I'm {current.name}, show my turn</button>
            </div>
          ) : (
            <Board
              state={state}
              view={god ? null : view}
              mazeOf={god ? current.id : viewerId}
              moveTargets={moveTargets}
              selected={selectedTo}
              selectedTile={selectedTile}
              onNodeClick={onNodeClick}
              onTileClick={onTileClick}
              onRoomClick={onRoomClick}
            />
          )}
        </div>
          <p className="hint">
            Viewing as <b>{god ? `god (maze shown for ${current.name})` : covered ? "nobody" : state.players.find((p) => p.id === viewerId)?.name ?? "spectator"}</b>.
            Hover squares for ids.
            {saveStatus && (saveStatus.ok
              ? <> Autosaved to <code>{saveStatus.path}</code>.</>
              : <span className="error"> Autosave failed: {saveStatus.error}</span>)}
          </p>
        </div>

        <aside className="side">
          {!finished && actorView && (
            <ActionPanel
              view={actorView}
              onAction={(a) => apply(current.id, a)}
              onBotTurn={botStep}
              selectedTo={selectedTo}
              setSelectedTo={setSelectedTo}
              selectedTile={selectedTile}
              setSelectedTile={setSelectedTile}
            />
          )}
          {!finished && !currentIsHuman && (
            <div className="actions"><p>🤖 {current.name} is playing{speed === "paused" ? " (paused: use Step bot)" : "…"}</p></div>
          )}
          {!covered && <Players state={state} view={view} god={god} isBot={isBot} onSettings={(id, settings) => apply(id, { type: "setSettings", settings })} />}
          {!covered && <Guesses view={view} />}
          {god && <Secrets state={state} />}
          <Stats st={st} />
          {!covered && <Log state={state} view={view} god={god} />}
        </aside>
      </div>
    </div>
  );
}

function Players({ state, view, god, isBot, onSettings }: {
  state: GameState;
  view: PlayerView;
  god: boolean;
  isBot: (id: string) => boolean;
  onSettings: (id: string, s: { fleeBelow?: number; autoLuck?: boolean }) => void;
}) {
  return (
    <section className="panel">
      <h3>Players</h3>
      {state.players.map((real, i) => {
        const p = view.players[i]!;
        const pos = god ? real.pos : p.pos;
        const editable = god ? !isBot(real.id) : real.id === view.viewerId;
        return (
          <div key={real.id} className={`player${i === state.currentIndex ? " current" : ""}${p.status !== "active" ? " removed" : ""}`}>
            <div>
              <Portrait archetype={p.archetype} color={seatColor(i)} /> <b>{p.name}</b> <small>{p.archetype}{isBot(p.id) ? " · bot" : ""}</small>
            </div>
            <div className="stats-line">
              Skill {p.skill} · Stamina <meter min={0} max={p.maxStamina} value={p.stamina} /> {p.stamina}/{p.maxStamina} · Luck {p.luck}
            </div>
            <div className="stats-line">
              Keys {p.keys.length ? [...p.keys].sort((a, b) => a - b).map((k) => `🔑${k}`).join(" ") : "none"} · {describeNode(pos)}
            </div>
            <div className="stats-line">
              Items {p.items.length ? p.items.map((i) => ITEM_NAMES[i]).join(", ") : "none"}
            </div>
            <div className="flags">
              {p.campReached && <span>wakes at camp</span>}
              {p.wizardBeaten && <span>wizard beaten</span>}
              {p.protected && <span>protected</span>}
              {p.skipNextTurn && <span>skips next turn</span>}
              {p.status === "removed" && <span>left the game</span>}
            </div>
            {editable && p.status === "active" && (
              <div className="settings">
                <label>
                  flee below{" "}
                  <input type="number" min={0} value={real.settings.fleeBelow} onChange={(e) => onSettings(real.id, { fleeBelow: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                </label>
                <label>
                  <input type="checkbox" checked={real.settings.autoLuck} onChange={(e) => onSettings(real.id, { autoLuck: e.target.checked })} /> auto-luck
                </label>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Guesses({ view }: { view: PlayerView }) {
  const candidates = candidateCombos(view.config.keyCount, view.config.comboSize, view.guesses);
  return (
    <section className="panel">
      <h3>Chest</h3>
      {view.guesses.length === 0 ? <p>No guesses yet.</p> : (
        <ul>
          {view.guesses.map((g, i) => (
            <li key={i}>{view.players.find((p) => p.id === g.playerId)?.name}: {g.keys.join(", ")} → {g.correct} correct</li>
          ))}
        </ul>
      )}
      <p>
        {candidates.length} combination{candidates.length === 1 ? "" : "s"} still possible
        {candidates.length <= 8 ? `: ${candidates.map((c) => c.join("-")).join(", ")}` : ""}.
      </p>
    </section>
  );
}

function Secrets({ state }: { state: GameState }) {
  return (
    <section className="panel secret">
      <h3>Secrets (god view)</h3>
      <p>Combination: <b>{state.combination.join(", ")}</b> · seed {state.seed} · rng {state.rng}</p>
      <ul className="rooms">
        {Object.entries(state.rooms).map(([id, r]) => (
          <li key={id} className={r.cleared ? "cleared" : ""}>
            {id.toUpperCase()}: {encounterLabel(r.encounter)} {r.cleared ? "(cleared)" : r.revealed ? "(revealed)" : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stats({ st }: { st: ReturnType<typeof stats> }) {
  return (
    <section className="panel">
      <h3>Stats</h3>
      <p>
        {st.turnsPerPlayer} turns/player · {st.actions} actions · {st.defeats} defeats · {st.wizardFights} wizard fights ·{" "}
        {st.pvpFights} PvP · {st.wrongGuesses} wrong guesses
      </p>
    </section>
  );
}

function Log({ state, view, god }: { state: GameState; view: PlayerView; god: boolean }) {
  const entries = (god ? state.log : view.log).slice(-200).reverse();
  return (
    <section className="panel log">
      <h3>Log</h3>
      <ol>
        {entries.map((e, i) => (
          <li key={i} className={e.privateTo ? "private" : ""}>
            <small>t{e.turn}</small> {e.text}
            {e.privateTo && god ? ` (private to ${state.players.find((p) => p.id === e.privateTo)?.name})` : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}
