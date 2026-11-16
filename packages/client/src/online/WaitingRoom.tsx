import { HelpButton } from "../Help.js";
import { useState } from "react";
import type { Archetype } from "@firetop/engine";
import { Portrait } from "../Cards.js";
import { seatColor } from "../describe.js";
import { ApiError, api, type GameResponse } from "./api.js";
import { HeroPicker } from "./heroes.js";
import { InviteLinks } from "./Lobby.js";
import { saveSeat, seatFor } from "./tokens.js";

/**
 * Before a game starts: invited players pick their name and hero here, and the
 * creator can start with whoever has joined. Updates come from the page's long-poll.
 */
export function WaitingRoom({ game, token, onUpdate }: { game: GameResponse; token: string; onUpdate: (r: GameResponse) => void }) {
  const mine = game.seats.find((s) => s.playerId === game.playerId);
  const myIdx = game.seats.findIndex((s) => s.playerId === game.playerId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(mine?.name ?? "");
  const [archetype, setArchetype] = useState<Archetype>(mine?.archetype ?? "warrior");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joined = game.seats.filter((s) => !s.open);
  const open = game.seats.filter((s) => s.open);
  const hostSeat = game.seats.find((s) => !s.bot);
  const showForm = !!mine && (mine.open || editing);
  const invites = game.host ? (seatFor(game.gameId)?.invites ?? []).filter((i) => open.some((s) => s.playerId === i.playerId)) : [];

  const run = async (call: () => Promise<GameResponse>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call();
      onUpdate(r);
      return r;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    const r = await run(() => api.claim(game.gameId, token, name.trim(), archetype));
    if (r) {
      saveSeat(game.gameId, token, name.trim());
      setEditing(false);
    }
  };

  return (
    <div className="setup online">
      <h1>Firetop Mountain <small>waiting for players</small> <HelpButton /></h1>

      {showForm && (
        <section className="card">
          <h2>{mine.open ? "Join the game" : "Change your seat"}</h2>
          <form
            className="claim"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void join();
            }}
          >
            <label>Your name <input value={name} maxLength={24} autoFocus placeholder="Your name" onChange={(e) => setName(e.target.value)} /></label>
            <HeroPicker value={archetype} color={seatColor(myIdx)} onChange={setArchetype} />
            <div className="row">
              <button type="submit" className="primary" disabled={busy || !name.trim()}>{mine.open ? "Join" : "Save"}</button>
              {!mine.open && <button type="button" className="link" onClick={() => setEditing(false)}>cancel</button>}
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <h2>Players <small>{joined.length} joined{open.length ? `, ${open.length} invited` : ""}</small></h2>
        <ul className="waiting-seats">
          {game.seats.map((s, i) => (
            <li key={s.playerId} className={s.open ? "open" : ""}>
              {s.archetype ? <Portrait archetype={s.archetype} color={seatColor(i)} size={32} /> : <span className="portrait open-seat" style={{ width: 32, height: 32, borderColor: seatColor(i) }}>?</span>}
              {s.open ? <span className="hint">{s.playerId === game.playerId ? "your seat: pick a name and hero above" : "waiting for an invited player…"}</span> : (
                <span>
                  <b>{s.name}</b> <small>{s.archetype}{s.bot ? " · bot" : ""}{s === hostSeat ? " · created the game" : ""}</small>
                  {s.playerId === game.playerId && <> <small>· you</small>{!editing && <button className="link" onClick={() => setEditing(true)}>change</button>}</>}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="hint">Players take turns in this order. This page updates by itself.</p>
      </section>

      {game.host ? (
        <section className="card">
          <h2>Start</h2>
          {invites.length > 0 && (
            <>
              <p>Invite links not used yet:</p>
              <InviteLinks invites={invites.map((inv) => ({ ...inv, label: `Seat ${game.seats.findIndex((s) => s.playerId === inv.playerId) + 1}` }))} />
            </>
          )}
          <p>
            The game starts by itself once everyone has joined. To start now, with the {joined.length} player{joined.length === 1 ? "" : "s"} who
            have joined, press <b>Start</b>: {open.length === 1 ? "the open seat is" : "open seats are"} left out.
          </p>
          <button className="primary" disabled={busy || joined.length < 2} onClick={() => void run(() => api.start(game.gameId, token))}>
            Start with {joined.length} player{joined.length === 1 ? "" : "s"}
          </button>
          {joined.length < 2 && <p className="hint">A game needs at least 2 players.</p>}
        </section>
      ) : (
        !showForm && <p className="hint">Waiting for {hostSeat?.name ?? "the creator"} to start the game, or for everyone to join.</p>
      )}
      {error && <p className="error">{error}</p>}
      <p className="hint"><a href="/online">Your games</a></p>
    </div>
  );
}
