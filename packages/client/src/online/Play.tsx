import { HelpButton } from "../Help.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { ITEM_NAMES, candidateCombos, type Action, type NodeId, type PlayerView } from "@firetop/engine";
import { ActionPanel, attackable } from "../ActionPanel.js";
import { Board } from "../Board.js";
import { CardPopup, Portrait, Vitals, cardsBetween, roomCard, sinceMyLastTurn, type CardData } from "../Cards.js";
import { MazeTurned, describeNode, seatColor } from "../describe.js";
import { PORTRAIT } from "../layout.js";
import { useBoardFocus, useIsPhone } from "../useBoardFocus.js";
import { ApiError, api, type GameResponse, type StartedGame } from "./api.js";
import { WaitingRoom } from "./WaitingRoom.js";
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
  // Phones get the portrait board with everything else in a sheet under it.
  const phone = useIsPhone();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const boardRef = useRef<HTMLDivElement>(null);
  const latest = useRef<GameResponse | null>(null);

  /**
   * Keep only the newest response (a long-poll and an action can cross). Every
   * change to a game moves its rev up, so a response at the rev we already show
   * is the same game: skip it rather than redraw the whole board (each action
   * comes back twice, from the POST and from the long-poll it wakes).
   */
  const accept = useCallback((r: GameResponse) => {
    setOffline(false);
    if (latest.current && r.rev <= latest.current.rev) return;
    latest.current = r;
    setGame(r);
  }, []);

  // Load, then long-poll for other players' moves for as long as the page is open.
  useEffect(() => {
    const abort = new AbortController();
    let stopped = false;
    (async () => {
      let backoff = 1000;
      while (!stopped) {
        try {
          const rev = latest.current?.rev;
          const r = await api.getGame(gameId, token, rev === undefined ? { signal: abort.signal } : { rev, signal: abort.signal });
          accept(r);
          backoff = 1000;
          if (r.status !== "active" && r.status !== "waiting") break; // game over: nothing more will happen
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

  const view = game?.view ?? undefined;
  const me = view?.players.find((p) => p.id === view.viewerId);
  const myTurn = !!view && !!game && game.status === "active" && view.currentPlayerId === view.viewerId && view.phase !== "finished";
  useEffect(() => {
    setSelectedTo(null);
    setSelectedTile(null);
  }, [game?.seq]);
  useBoardFocus(boardRef, view?.me?.pos ?? null, [zoomed, phone, game?.seq]);

  const send = async (action: Action) => {
    if (!game?.view || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.act(gameId, token, action, game.seq);
      const shown = r.view ? cardsBetween(game.view, r.view) : [];
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
  if (game?.status === "waiting") return <WaitingRoom game={game} token={token} onUpdate={accept} />;
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
  const news = game.status === "active" ? sinceMyLastTurn(view).length : 0;
  const actions = myTurn ? (
    // The tile pickers must match the board: on phones the maze is drawn turned.
    <MazeTurned.Provider value={phone}>
      <ActionPanel
        view={view}
        onAction={(a) => void send(a)}
        selectedTo={selectedTo}
        setSelectedTo={setSelectedTo}
        selectedTile={selectedTile}
        setSelectedTile={setSelectedTile}
      />
    </MazeTurned.Provider>
  ) : game.status === "active" && current ? (
    <div className="actions waiting">
      <p>Waiting for <b>{current.name}</b>{game.seats.find((s) => s.playerId === current.id)?.bot ? " (bot)" : ""}.</p>
      <p className="hint">This page updates by itself. You can close it and come back with the same link.</p>
    </div>
  ) : null;
  const details = (
    <>
      <Players game={game as StartedGame} onSettings={(settings) => void send({ type: "setSettings", settings })} />
      <Chest view={view} />
      <Log view={view} />
    </>
  );

  return (
    <div className={`game online${phone ? " shell" : ""}`}>
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
        <HelpButton label="?" />
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
              {...(phone ? { layout: PORTRAIT } : {})}
            />
          </div>
        </div>

        {phone ? (
          <aside className={`side sheet${sheetOpen ? " open" : ""}`}>
            <button className="sheet-handle" aria-expanded={sheetOpen} onClick={() => setSheetOpen(!sheetOpen)}>
              {sheetOpen ? "▼ Back to the board" : `▲ Players, chest & log${news ? ` · ${news} new` : ""}`}
            </button>
            <Vitals player={me} color={seatColor(view.players.indexOf(me))} />
            {actions}
            {sheetOpen && (
              <>
                {game.status === "active" && <Recent view={view} myTurn={myTurn} />}
                {details}
              </>
            )}
          </aside>
        ) : (
          <aside className="side">
            {game.status === "active" && <Recent view={view} myTurn={myTurn} />}
            {actions}
            {details}
          </aside>
        )}
      </div>
    </div>
  );
}

function Players({ game, onSettings }: { game: StartedGame; onSettings: (s: { fleeBelow?: number; autoLuck?: boolean }) => void }) {
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

/** Other players' moves since your last turn, so they don't need a popup each. */
function Recent({ view, myTurn }: { view: PlayerView; myTurn: boolean }) {
  const events = sinceMyLastTurn(view);
  if (events.length === 0) return null;
  const shown = events.slice(-12);
  return (
    <section className="panel log recent">
      <h3>{myTurn ? "Since your last turn" : "Since your turn"}</h3>
      <ol>
        {shown.map((e, i) => (
          <li key={i} className={e.privateTo ? "private" : ""}><small>t{e.turn}</small> {e.text}</li>
        ))}
      </ol>
      {events.length > shown.length && <p className="hint">{events.length - shown.length} earlier in the log below.</p>}
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
