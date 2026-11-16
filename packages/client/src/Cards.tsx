import { useEffect } from "react";
import {
  ITEM_NAMES,
  type Archetype, type Encounter, type GameEvent, type PeekedEncounter, type PlayerView, type PublicEncounter, type PublicPlayer,
} from "@firetop/engine";
import { ARCHETYPE_ICON, IconSvg, type IconName } from "./art/icons.js";
import { artUrl, type ArtKind } from "./art/slots.js";
import { encounterIcon } from "./Board.js";

type AnyEncounter = Encounter | PublicEncounter | PeekedEncounter;

export interface CardData {
  /** Drives the frame colour. */
  tone: "monster" | "treasure" | "trap" | "wizard" | "duel" | "defeat" | "victory" | "secret";
  title: string;
  subtitle?: string;
  icon: IconName;
  /** Hand-made art for this card, if the slot has a file. */
  art?: { kind: ArtKind; name: string };
  stats?: [string, string | number][];
  lines?: string[];
}

const ITEM_TEXT: Record<string, string> = {
  provisions: "Eat before rolling (free) to regain Stamina.",
  skillPotion: "Drunk at once: +Skill.",
  luckPotion: "Drunk at once: +Luck.",
  sword: "+Skill against monsters and the Warlock.",
  shield: "Each lost round costs 1 less Stamina.",
  amulet: "Keeps your keys the next time you fall.",
  scroll: "Read before rolling to see inside one room.",
};

/** The card for a room's contents (what the viewer is allowed to know). */
export function roomCard(room: string, e: AnyEncounter, opts: { cleared?: boolean; secret?: boolean } = {}): CardData {
  const where = `Room ${room.toUpperCase()}${opts.cleared ? " · cleared" : ""}`;
  const secretLine = opts.secret ? ["Only you can see this (Scroll of Seeing)."] : [];
  switch (e.kind) {
    case "monster": {
      const key = "loot" in e ? e.loot : "guardsKey" in e ? e.guardsKey : null;
      return {
        tone: opts.secret ? "secret" : "monster",
        title: e.name,
        subtitle: where,
        icon: "monster",
        art: { kind: "monsters", name: e.name },
        stats: [
          ["Skill", e.skill],
          e.stamina > 0 ? ["Stamina", e.stamina] : ["", "Defeated"],
          ...(key !== null ? [["Guards key", key] as [string, number]] : []),
        ],
        lines: secretLine,
      };
    }
    case "treasure":
      return {
        tone: opts.secret ? "secret" : "treasure",
        title: ITEM_NAMES[e.item],
        subtitle: where,
        icon: encounterIcon(e),
        art: { kind: "locations", name: room },
        stats: e.key !== null ? [["Key", e.key]] : [],
        lines: [ITEM_TEXT[e.item] ?? "", ...secretLine].filter(Boolean),
      };
    case "trap":
      return {
        tone: opts.secret ? "secret" : "trap",
        title: "Trap",
        subtitle: where,
        icon: "trap",
        art: { kind: "locations", name: room },
        stats: [["Damage", `-${e.damage}`]],
        lines: secretLine,
      };
    case "empty":
      return { tone: "secret", title: "Empty room", subtitle: where, icon: "unknown", lines: secretLine };
  }
}

const OUTCOME_TYPES = new Set(["combat", "treasure", "trap", "defeat", "camp", "item", "pickup"]);

/**
 * Cards for what the viewer's own action just did, from two of their views
 * (before and after). Works from PlayerViews only, so the online client can use
 * it too. `after` may already include later players' turns (the server plays
 * bots straight after you); only events from the viewer's turn make cards, so
 * other players' moves never pop up.
 */
export function cardsBetween(before: PlayerView, after: PlayerView): CardData[] {
  if (before.viewerId !== after.viewerId || before.currentPlayerId !== before.viewerId) return [];
  // Every player turn has its own turn number, so this is exactly the viewer's turn.
  const fresh: GameEvent[] = after.log.slice(before.log.length).filter((e) => e.turn === before.turn);
  if (fresh.length === 0) return [];
  const cards: CardData[] = [];
  const text = (types: string[]) => fresh.filter((e) => types.includes(e.type)).map((e) => e.text);

  const rooms = [...new Set(fresh.flatMap((e) => (e.room ? [e.room] : [])))];
  for (const room of rooms) {
    const r = after.rooms[room];
    if (!r?.revealed || before.rooms[room]?.revealed || !r.encounter) continue;
    const card = roomCard(room, r.encounter, { cleared: r.cleared });
    card.lines = [...(card.lines ?? []), ...fresh.filter((e) => OUTCOME_TYPES.has(e.type)).map((e) => e.text)];
    cards.push(card);
  }
  const wizard = text(["wizard"]);
  if (wizard.length) {
    const w = after.config.wizard;
    cards.push({
      tone: "wizard",
      title: w.name,
      subtitle: "The lair",
      icon: "lair",
      art: { kind: "monsters", name: w.name },
      stats: [["Skill", w.skill], ["Stamina", w.stamina]],
      lines: [...wizard, ...text(["defeat"])],
    });
  }
  const duels = text(["pvp"]);
  if (duels.length) cards.push({ tone: "duel", title: "Duel", icon: "crossedSwords", lines: [...duels, ...text(["defeat"])] });
  for (const e of fresh.filter((x) => x.type === "peek")) {
    const room = Object.keys(after.me?.peeks ?? {}).find((id) => !before.me?.peeks[id]);
    const peek = room ? after.me?.peeks[room] : undefined;
    if (room && peek) cards.push(roomCard(room, peek, { secret: true }));
    else cards.push({ tone: "secret", title: "Scroll of Seeing", icon: "scroll", lines: [e.text] });
  }
  const guesses = text(["guess"]);
  if (guesses.length) cards.push({ tone: "trap", title: "The chest", icon: "treasure", lines: guesses });
  const win = text(["win"]);
  if (win.length) cards.push({ tone: "victory", title: "Victory", icon: "crown", lines: win });
  // A fall with no other card (e.g. a trap in a known room) still deserves one.
  if (cards.length === 0 && text(["defeat"]).length) cards.push({ tone: "defeat", title: "Fallen", icon: "skull", lines: text(["trap", "defeat"]) });
  return cards;
}

/**
 * What everyone else did since the viewer's last turn ended: the "while you
 * were away" feed. Relies on the turn number going up by one each time play
 * passes to the next seat, so the viewer's turns are `players.length` apart.
 */
export function sinceMyLastTurn(view: PlayerView): GameEvent[] {
  const n = view.players.length;
  const me = view.players.findIndex((p) => p.id === view.viewerId);
  const current = view.players.findIndex((p) => p.id === view.currentPlayerId);
  if (me < 0 || current < 0) return [];
  const back = (current - me + n) % n;
  const myLastTurn = back === 0 ? view.turn - n : view.turn - back;
  return view.log.filter((e) => e.turn > myLastTurn && !(back === 0 && e.turn === view.turn));
}

export function Card({ card }: { card: CardData }) {
  const url = card.art ? artUrl(card.art.kind, card.art.name) : null;
  return (
    <article className={`card-face tone-${card.tone}`}>
      <div className="card-art">
        {url ? <img src={url} alt={card.title} /> : <div className="card-emblem"><IconSvg name={card.icon} size={84} /></div>}
      </div>
      <header>
        <h3>{card.title}</h3>
        {card.subtitle && <small>{card.subtitle}</small>}
      </header>
      {card.stats && card.stats.length > 0 && (
        <div className="card-stats">
          {card.stats.map(([k, v]) => <span key={k || String(v)}><b>{v}</b> {k}</span>)}
        </div>
      )}
      {card.lines && card.lines.length > 0 && <ul>{card.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </article>
  );
}

/** Modal stack of cards; click, Enter or Escape to dismiss. */
export function CardPopup({ cards, onClose }: { cards: CardData[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (cards.length === 0) return null;
  return (
    <div className="card-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="card-row" onClick={(e) => e.stopPropagation()}>
        {cards.map((c, i) => <Card key={i} card={c} />)}
      </div>
      <button className="primary" onClick={onClose} autoFocus>Continue</button>
    </div>
  );
}

/** A player's portrait: provided art, or a generated emblem in their seat colour. */
/**
 * One player's vital stats in a single line: Stamina as a bar, then Skill, Luck
 * and keys. Sits at the top of the phone sheet so your health is always in view.
 */
export function Vitals({ player, color }: { player: PublicPlayer; color: string }) {
  const frac = player.maxStamina > 0 ? Math.max(0, Math.min(1, player.stamina / player.maxStamina)) : 0;
  const level = frac > 0.5 ? "ok" : frac > 0.25 ? "low" : "danger";
  return (
    <div className="vitals" aria-label={`${player.name}: Stamina ${player.stamina} of ${player.maxStamina}, Skill ${player.skill}, Luck ${player.luck}`}>
      <Portrait archetype={player.archetype} color={color} size={28} />
      <div className="vitals-stamina">
        <div className={`bar ${level}`}><span style={{ width: `${frac * 100}%` }} /></div>
        <small><b>{player.stamina}</b>/{player.maxStamina} Stamina</small>
      </div>
      <span className="vitals-stat"><b>{player.skill}</b> Skill</span>
      <span className="vitals-stat"><b>{player.luck}</b> Luck</span>
      <span className="vitals-stat">🔑 <b>{player.keys.length ? [...player.keys].sort((a, b) => a - b).join(" ") : "–"}</b></span>
    </div>
  );
}

export function Portrait({ archetype, color, size = 34 }: { archetype: Archetype; color: string; size?: number }) {
  const url = artUrl("portraits", archetype);
  return (
    <span className="portrait" style={{ width: size, height: size, borderColor: color }}>
      {url ? <img src={url} alt={archetype} /> : <IconSvg name={ARCHETYPE_ICON[archetype]} size={size * 0.62} title={archetype} />}
    </span>
  );
}
