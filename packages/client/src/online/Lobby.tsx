import { HelpButton } from "../Help.js";
import { useState } from "react";
import type { Archetype } from "@firetop/engine";
import { Portrait } from "../Cards.js";
import { seatColor } from "../describe.js";
import { ApiError, api, type CreatedGame, type NewGameRequest } from "./api.js";
import { ABILITY, ARCHS, heroStats } from "./heroes.js";
import { mySeats, saveSeat } from "./tokens.js";

const TURN_LENGTHS: { seconds: number; label: string }[] = [
  { seconds: 3600, label: "1 hour" },
  { seconds: 43_200, label: "12 hours" },
  { seconds: 86_400, label: "24 hours" },
  { seconds: 259_200, label: "3 days" },
];

/** The first seat is always yours; the others are invited people (who pick their own hero) or bots. */
interface SeatForm { kind: "you" | "invite" | "bot"; name: string; archetype: Archetype }

/** Online games: start one (and hand out invite links), or go back to one of yours. */
export function Lobby() {
  const [seats, setSeats] = useState<SeatForm[]>([
    { kind: "you", name: "", archetype: "warrior" },
    { kind: "invite", name: "", archetype: "lucky" },
  ]);
  const [turnSeconds, setTurnSeconds] = useState(86_400);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedGame | null>(null);
  const games = mySeats();

  const setSeat = (i: number, patch: Partial<SeatForm>) => setSeats(seats.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const placeholder = (s: SeatForm, i: number) => (s.kind === "bot" ? `Bot ${i + 1}` : "Your name");

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const req: NewGameRequest["seats"] = seats.map((s, i) =>
        s.kind === "invite"
          ? { open: true }
          : { name: s.name.trim() || (s.kind === "bot" ? `Bot ${i + 1}` : "Player 1"), archetype: s.archetype, bot: s.kind === "bot" });
      const res = await api.createGame({ turnSeconds, seats: req });
      // This browser is the creator's seat; keep its token (and the invite links) so it can come back.
      const [mine, ...others] = res.invites;
      if (mine) saveSeat(res.gameId, mine.url.split("#")[1]!, mine.name, others.map((o) => ({ playerId: o.playerId, url: o.url })));
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
      <h1>Firetop Mountain <small>online</small> <HelpButton /></h1>
      <section className="card">
        <h2>New game</h2>
        <table className="seats">
          <thead><tr><th /><th>Seat</th><th>Name</th><th>Hero</th><th /></tr></thead>
          <tbody>
            {seats.map((s, i) => (
              <tr key={i}>
                <td>{s.kind === "invite" ? <span className="portrait open-seat" style={{ width: 28, height: 28, borderColor: seatColor(i) }}>?</span> : <Portrait archetype={s.archetype} color={seatColor(i)} size={28} />}</td>
                <td>
                  {s.kind === "you" ? <b>You</b> : (
                    <select aria-label="Played by" value={s.kind} onChange={(e) => setSeat(i, { kind: e.target.value as SeatForm["kind"] })}>
                      <option value="invite">a person (invite link)</option>
                      <option value="bot">a bot</option>
                    </select>
                  )}
                </td>
                {s.kind === "invite" ? (
                  <><td className="hint">picks their own name and hero</td><td /></>
                ) : (
                  <>
                    <td><input aria-label="Name" value={s.name} placeholder={placeholder(s, i)} maxLength={24} onChange={(e) => setSeat(i, { name: e.target.value })} /></td>
                    <td>
                      <select aria-label="Hero" value={s.archetype} onChange={(e) => setSeat(i, { archetype: e.target.value as Archetype })}>
                        {ARCHS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </td>
                  </>
                )}
                <td>{s.kind !== "you" && seats.length > 2 && <button className="link" onClick={() => setSeats(seats.filter((_, j) => j !== i))}>remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {seats.length < 4 && <button onClick={() => setSeats([...seats, { kind: "invite", name: "", archetype: ARCHS[seats.length % 3]! }])}>+ Add a seat</button>}
        <ul className="hint heroes">
          {ARCHS.map((a) => <li key={a}><b>{a}</b>: {heroStats(a)}; {ABILITY[a]}.</li>)}
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
        {seats.some((s) => s.kind === "invite") && (
          <p className="hint">
            The game starts once everyone you invite has joined, or earlier if you press <b>Start</b>: seats nobody has
            claimed by then are left out.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create game"}</button>
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
  const [mine, ...others] = created.invites;
  return (
    <div className="setup online">
      <h1>Game created</h1>
      <section className="card">
        {others.length > 0 ? (
          <>
            <p>Send one link to each player. <b>Anyone with a link takes that seat</b> and picks their own name and hero.</p>
            <InviteLinks invites={others.map((o, i) => ({ playerId: o.playerId, url: o.url, label: `Invite ${i + 1}` }))} />
            <p className="hint">You'll find these links again in the game's waiting room on this device.</p>
          </>
        ) : <p>Everyone else is a bot, so the game has started.</p>}
        {mine && (
          <div className="row">
            <a className="button primary" href={mine.url}>{created.status === "waiting" ? "Go to the waiting room" : `Play as ${mine.name}`}</a>
          </div>
        )}
      </section>
      <button className="link" onClick={onAnother}>Create another game</button>
    </div>
  );
}

/** Invite links with copy buttons (the lobby after creating a game, and the host's waiting room). */
export function InviteLinks({ invites }: { invites: { playerId: string; url: string; label: string }[] }) {
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
  return (
    <ul className="invites">
      {invites.map((inv) => (
        <li key={inv.playerId}>
          <b>{inv.label}</b>
          <input readOnly value={abs(inv.url)} onFocus={(e) => e.target.select()} />
          <button onClick={() => copy(inv.playerId, inv.url)}>{copied === inv.playerId ? "Copied" : "Copy"}</button>
        </li>
      ))}
    </ul>
  );
}
