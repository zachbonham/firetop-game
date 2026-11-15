import { useCallback, useEffect, useRef, useState } from "react";
import { ITEM_NAMES, candidateCombos, type Action, type NodeId, type PlayerView } from "@firetop/engine";
import { ActionPanel, attackable } from "../ActionPanel.js";
import { Board } from "../Board.js";
import { CardPopup, Portrait, cardsBetween, roomCard, type CardData } from "../Cards.js";
import { describeNode, seatColor } from "../describe.js";
import { useBoardFocus } from "../useBoardFocus.js";
import { ApiError, api, type GameResponse } from "./api.js";
import { parsePlayUrl, saveSeat, seatFor, timeLeft } from "./tokens.js";

/** Find this game's seat token: from the invite link's #fragment (then hidden), or saved on this device. */
function useSeat(): { gameId: string; token: string | null } | null {
  const [seat] = useState(() => {
    const parsed = parsePlayUrl(window.location.pathname, window.location.hash);
    if (!parsed) return null;
    if (parsed.token) {
      saveSeat(parsed.gameId, parsed.token);
      // Keep the token out of the address bar (screenshots, screen sharing). It's saved on this device.
      window.history.replaceState(null, "", `/play/${parsed.gameId}`);
      return parsed;
    }
    return { gameId: parsed.gameId, token: seatFor(parsed.gameId)?.token ?? null };
  });
  return seat;
}

export function Play() {
  const seat = useSeat();
  if (!seat) return <Message title="Not a game link">Game links look like <code>/play/&lt;game&gt;#&lt;seat&gt;</code>. <a href="/online">Start a game</a>.</Message>;
  if (!seat.token) {
    return (
      <Message title="Open your invite link">
        This device doesn't have a seat in game <code>{seat.gameId}</code>. Open the invite link you were sent
        (it ends with <code>#</code> and a long code). <a href="/online">Your games</a>
      </Message>
    );
  }
  return <OnlineGame gameId={seat.gameId} token={seat.token} />;
}

function OnlineGame({ gameId, token }: { gameId: string; token: string }) {
  const [game, setGame] = useState<GameResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<CardData[]>([]);
  const [selectedTo, setSelectedTo] = useState<NodeId | null>(null);
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const boardRef = useRef<HTMLDivElement>(null);
  const latest = useRef<GameResponse | null>(null);

  /** Keep only the newest response (a long-poll and an action can cross). */
  const accept = useCallback((r: GameResponse) => {
    if (latest.current && r.seq < latest.current.seq) return;
    latest.current = r;
    setGame(r);
    setOffline(false);
  }, []);

  // Load, then long-poll for other players' moves for as long as the page is open.
  useEffect(() => {
    const abort = new AbortController();
    let stopped = false;
    (async () => {
      let backoff = 1000;
      while (!stopped) {
        try {
          const since = latest.current?.seq;
          const r = await api.getGame(gameId, token, since === undefined ? { signal: abort.signal } : { since, signal: abort.signal });
          accept(r);
          backoff = 1000;
          if (r.status !== "active") break; // game over: nothing more will happen
        } catch (e) {
          if (stopped) return;
          if (e instanceof ApiError && [401, 404, 410].includes(e.status)) {
            setFatal(e.status === 401 ? "This device's seat token isn't valid for this game. Open your invite link again." : e.message);
            return;
          }
          setOffline(true);
          await new Promise((res) => setTimeout(res, backoff));
          backoff = Math.min(backoff * 2, 30_000);
        }
      }
    })();
    return () => {
      stopped = true;
      abort.abort();
    };
  }, [gameId, token, accept]);

  // Tick the countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const view = game?.view;
  const me = view?.players.find((p) => p.id === view.viewerId);
  const myTurn = !!view && !!game && game.status === "active" && view.currentPlayerId === view.viewerId && view.phase !== "finished";
  useEffect(() => {
    setSelectedTo(null);
    setSelectedTile(null);
  }, [game?.seq]);
  useBoardFocus(boardRef, view?.me?.pos ?? null, [zoomed, game?.seq]);

  const send = async (action: Action) => {
    if (!game || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.act(gameId, token, action, game.seq);
      const shown = cardsBetween(game.view, r.view);
      if (shown.length) setCards(shown);
      accept(r);
    } catch (e) {
      if (e instanceof ApiError && (e.code === "stale_seq" || e.code === "game_over")) {
        // Someone else moved first (or the game ended): show the latest and let the player retry.
        accept(await api.getGame(gameId, token));
        setError(e.code === "stale_seq" ? "The game moved on before your action arrived: check the board and try again." : "This game is over.");
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (fatal) return <Message title="Can't open this game">{fatal} <a href="/online">Your games</a></Message>;
  if (!game || !view || !me) return <Message title="Loading…">{offline ? "Can't reach the game server; retrying…" : "Fetching the game."}</Message>;

  const current = view.players.find((p) => p.id === view.currentPlayerId);
  const currentIdx = view.players.findIndex((p) => p.id === view.currentPlayerId);
  const moveTargets = new Set(myTurn ? view.me?.moveOptions.map((o) => o.to) ?? [] : []);
  const onNodeClick = (id: NodeId) => {
    if (!myTurn || !moveTargets.has(id)) return;
    if (attackable(view, id).length === 0) void send({ type: "move", to: id });
    else setSelectedTo(id);
  };
  const onRoomClick = (room: string) => {
    const pub = view.rooms[room];
    if (pub?.revealed && pub.encounter) return setCards([roomCard(room, pub.encounter, { cleared: pub.cleared })]);
    const peek = view.me?.peeks[room];
    if (peek) setCards([roomCard(room, peek, { secret: true })]);
  };
  const winner = view.players.find((p) => p.id === view.winner);

  return (
    <div className="game online">
      <header className="topbar">
        <a href="/online" className="home" title="Your games">⛰</a>
        <b>Turn {view.turn}</b>
        {game.status === "active" && current && (
          <span>
            <span className="swatch" style={{ background: seatColor(currentIdx) }} /> {myTurn ? <b>Your turn</b> : <>{current.name}'s turn</>}
            {game.deadline && <span className="hint"> · times out {timeLeft(game.deadline, now)}</span>}
          </span>
        )}
        <span className="spacer" />
        {offline && <span className="error">offline, retrying…</span>}
        {busy && <span className="hint">sending…</span>}
        <span className="hint">You are <b>{me.name}</b></span>
      </header>

      {cards.length > 0 && <CardPopup cards={cards} onClose={() => setCards([])} />}
      {error && <div className="error banner" onClick={() => setError(null)}>{error} <small>(click to dismiss)</small></div>}
      {game.status === "finished" && <div className="win banner">🏆 {winner?.id === me.id ? "You win!" : `${winner?.name ?? "Someone"} wins.`}</div>}
      {game.status === "abandoned" && <div className="error banner">This game was abandoned: no players were left. Nobody wins.</div>}
      {me.status === "removed" && game.status === "active" && <div className="error banner">You missed too many turns and left the game. You can still watch.</div>}

      <div className="main">
        <div className="board-col">
          <div className={`board-wrap${zoomed ? " zoomed" : ""}`} ref={boardRef}>
            <button className="zoom-toggle" onClick={() => setZoomed(!zoomed)}>{zoomed ? "Whole board" : "Zoom in"}</button>
            <Board
              view={view}
              moveTargets={moveTargets}
              selected={selectedTo}
              selectedTile={selectedTile}
              onNodeClick={onNodeClick}
              onTileClick={(r, c) => { if (myTurn && view.phase === "roll") setSelectedTile(`${r}:${c}`); }}
              onRoomClick={onRoomClick}
            />
          </div>
        </div>

        <aside className="side">
          {myTurn ? (
            <ActionPanel
              view={view}
              onAction={(a) => void send(a)}
              selectedTo={selectedTo}
              setSelectedTo={setSelectedTo}
              selectedTile={selectedTile}
              setSelectedTile={setSelectedTile}
            />
          ) : game.status === "active" && current ? (
            <div className="actions waiting">
              <p>Waiting for <b>{current.name}</b>{game.seats.find((s) => s.playerId === current.id)?.bot ? " (bot)" : ""}.</p>
              <p className="hint">This page updates by itself. You can close it and come back with the same link.</p>
            </div>
          ) : null}
          <Players game={game} onSettings={(settings) => void send({ type: "setSettings", settings })} />
          <Chest view={view} />
          <Log view={view} />
        </aside>
      </div>
    </div>
  );
}

function Players({ game, onSettings }: { game: GameResponse; onSettings: (s: { fleeBelow?: number; autoLuck?: boolean }) => void }) {
  const view = game.view;
  return (
    <section className="panel">
      <h3>Players</h3>
      {view.players.map((p, i) => {
        const bot = game.seats.find((s) => s.playerId === p.id)?.bot;
        const mine = p.id === view.viewerId;
        return (
          <div key={p.id} className={`player${p.id === view.currentPlayerId ? " current" : ""}${p.status !== "active" ? " removed" : ""}`}>
            <div>
              <Portrait archetype={p.archetype} color={seatColor(i)} /> <b>{p.name}</b> <small>{p.archetype}{bot ? " · bot" : ""}{mine ? " · you" : ""}</small>
            </div>
            <div className="stats-line">
              Skill {p.skill} · Stamina <meter min={0} max={p.maxStamina} value={p.stamina} /> {p.stamina}/{p.maxStamina} · Luck {p.luck}
            </div>
            <div className="stats-line">
              Keys {p.keys.length ? [...p.keys].sort((a, b) => a - b).map((k) => `🔑${k}`).join(" ") : "none"} · {describeNode(p.pos)}
            </div>
            <div className="stats-line">Items {p.items.length ? p.items.map((it) => ITEM_NAMES[it]).join(", ") : "none"}</div>
            <div className="flags">
              {p.campReached && <span>wakes at camp</span>}
              {p.wizardBeaten && <span>wizard beaten</span>}
              {p.protected && <span>protected</span>}
              {p.skipNextTurn && <span>skips next turn</span>}
              {p.status === "removed" && <span>left the game</span>}
            </div>
            {mine && view.me && p.status === "active" && game.status === "active" && (
              <div className="settings">
                <label title="Flee a fight automatically once your Stamina drops below this (0 = never)">
                  flee below{" "}
                  <input type="number" min={0} value={view.me.settings.fleeBelow} onChange={(e) => onSettings({ fleeBelow: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                </label>
                <label title="Spend Luck to reroll a combat round you're losing">
                  <input type="checkbox" checked={view.me.settings.autoLuck} onChange={(e) => onSettings({ autoLuck: e.target.checked })} /> auto-luck
                </label>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Chest({ view }: { view: PlayerView }) {
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

function Log({ view }: { view: PlayerView }) {
  return (
    <section className="panel log">
      <h3>Log</h3>
      <ol>
        {view.log.slice(-200).reverse().map((e, i) => (
          <li key={i} className={e.privateTo ? "private" : ""}><small>t{e.turn}</small> {e.text}</li>
        ))}
      </ol>
    </section>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="setup online">
      <section className="card">
        <h2>{title}</h2>
        <p>{children}</p>
      </section>
    </div>
  );
}
