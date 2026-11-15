import { useState } from "react";
import { DEFAULT_CONFIG, type Archetype } from "@firetop/engine";
import { Portrait } from "../Cards.js";
import { seatColor } from "../describe.js";
import { ApiError, api, type CreatedGame } from "./api.js";
import { mySeats, saveSeat } from "./tokens.js";

const ARCHS: Archetype[] = ["warrior", "survivor", "lucky"];
const TURN_LENGTHS: { seconds: number; label: string }[] = [
  { seconds: 3600, label: "1 hour" },
  { seconds: 43_200, label: "12 hours" },
  { seconds: 86_400, label: "24 hours" },
  { seconds: 259_200, label: "3 days" },
];
const ABILITY: Record<Archetype, string> = {
  warrior: "best fighter",
  survivor: "deep Stamina, rests heal more",
  lucky: "rerolls lost rounds, rests win Luck back",
};

interface SeatForm { name: string; archetype: Archetype; bot: boolean }

/** Online games: start one (and hand out invite links), or go back to one of yours. */
export function Lobby() {
  const [seats, setSeats] = useState<SeatForm[]>([
    { name: "", archetype: "warrior", bot: false },
    { name: "", archetype: "lucky", bot: false },
  ]);
  const [turnSeconds, setTurnSeconds] = useState(86_400);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedGame | null>(null);
  const games = mySeats();

  const setSeat = (i: number, patch: Partial<SeatForm>) => setSeats(seats.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const named = seats.map((s, i) => ({ ...s, name: s.name.trim() || (s.bot ? `Bot ${i + 1}` : `Player ${i + 1}`) }));
  const problem = !seats.some((s) => !s.bot) ? "At least one seat must be a person." : null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createGame({ turnSeconds, seats: named });
      // This browser is the first human seat; keep its token so "Play" works without the link.
      const mine = res.invites[0];
      if (mine) saveSeat(res.gameId, mine.url.split("#")[1]!, mine.name);
      setCreated(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (created) return <Invites created={created} onAnother={() => setCreated(null)} />;

  return (
    <div className="setup online">
      <h1>Firetop Mountain <small>online</small></h1>
      <section className="card">
        <h2>New game</h2>
        <table className="seats">
          <thead><tr><th /><th>Name</th><th>Hero</th><th>Played by</th><th /></tr></thead>
          <tbody>
            {seats.map((s, i) => (
              <tr key={i}>
                <td><Portrait archetype={s.archetype} color={seatColor(i)} size={28} /></td>
                <td><input value={s.name} placeholder={s.bot ? `Bot ${i + 1}` : `Player ${i + 1}`} maxLength={24} onChange={(e) => setSeat(i, { name: e.target.value })} /></td>
                <td>
                  <select value={s.archetype} onChange={(e) => setSeat(i, { archetype: e.target.value as Archetype })}>
                    {ARCHS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </td>
                <td>
                  <select value={s.bot ? "bot" : "human"} onChange={(e) => setSeat(i, { bot: e.target.value === "bot" })}>
                    <option value="human">a person (invite link)</option>
                    <option value="bot">a bot</option>
                  </select>
                </td>
                <td>{seats.length > 2 && <button className="link" onClick={() => setSeats(seats.filter((_, j) => j !== i))}>remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {seats.length < 4 && <button onClick={() => setSeats([...seats, { name: "", archetype: ARCHS[seats.length % 3]!, bot: true }])}>+ Add a seat</button>}
        <ul className="hint heroes">
          {ARCHS.map((a) => {
            const st = DEFAULT_CONFIG.archetypes[a];
            return <li key={a}><b>{a}</b>: Skill {st.skill}, Stamina {st.stamina}, Luck {st.luck}; {ABILITY[a]}.</li>;
          })}
        </ul>
        <div className="row">
          <label>
            Time per turn{" "}
            <select value={turnSeconds} onChange={(e) => setTurnSeconds(Number(e.target.value))}>
              {TURN_LENGTHS.map((t) => <option key={t.seconds} value={t.seconds}>{t.label}</option>)}
            </select>
          </label>
          <span className="hint">Miss 3 turns in a row and you're out. Finish early and the next player can go at once.</span>
        </div>
        {problem && <p className="problems">{problem}</p>}
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy || !!problem} onClick={create}>{busy ? "Creating…" : "Create game"}</button>
      </section>

      {games.length > 0 && (
        <section className="card">
          <h2>Your games <small>(on this device)</small></h2>
          <ul className="my-games">
            {games.map((g) => (
              <li key={g.gameId}>
                <a href={`/play/${g.gameId}`}>{g.name ? `${g.name} · ` : ""}game {g.gameId}</a> <small className="hint">joined {new Date(g.savedAt).toLocaleDateString()}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="hint"><a href="/local">Local test board</a> (hot-seat, bots, balance tools)</p>
    </div>
  );
}

function Invites({ created, onAnother }: { created: CreatedGame; onAnother: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const abs = (url: string) => new URL(url, window.location.origin).toString();
  const copy = async (playerId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(abs(url));
      setCopied(playerId);
    } catch {
      setCopied(null);
    }
  };
  const [mine, ...others] = created.invites;
  return (
    <div className="setup online">
      <h1>Game created</h1>
      <section className="card">
        <p>Each link is a seat: <b>anyone with a link plays that seat</b>, so send each one only to its player.</p>
        <ul className="invites">
          {created.invites.map((inv) => (
            <li key={inv.playerId}>
              <b>{inv.name}</b>
              <input readOnly value={abs(inv.url)} onFocus={(e) => e.target.select()} />
              <button onClick={() => copy(inv.playerId, inv.url)}>{copied === inv.playerId ? "Copied" : "Copy"}</button>
            </li>
          ))}
        </ul>
        {mine && (
          <div className="row">
            <a className="button primary" href={mine.url}>Play as {mine.name}</a>
            {others.length > 0 && <span className="hint">This device is saved as {mine.name}'s seat.</span>}
          </div>
        )}
      </section>
      <button className="link" onClick={onAnother}>Create another game</button>
    </div>
  );
}
