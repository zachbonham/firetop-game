import { useContext, useEffect, useState } from "react";
import {
  ENTRY_ROW, ITEM_NAMES, LAIR, MAZE_SQUARE, candidateCombos, isMazeTile, mazeHint, openings, reachableFromEntry,
  type Action, type NodeId, type PlayerView, type PublicPlayer,
} from "@firetop/engine";
import { TileIcon } from "./Board.js";
import { MazeTurned, describeNode, sideName } from "./describe.js";

interface Props {
  view: PlayerView;
  onAction: (a: Action) => void;
  /** Local test board only: let the scripted bot pick this step. */
  onBotTurn?: () => void;
  selectedTo: NodeId | null;
  setSelectedTo: (id: NodeId | null) => void;
  selectedTile: string | null;
  setSelectedTile: (key: string | null) => void;
}

/** Players the viewer could attack on `node` (not in the maze, not protected). */
export function attackable(view: PlayerView, node: NodeId): PublicPlayer[] {
  if (isMazeTile(node)) return [];
  return view.players.filter(
    (p) => p.id !== view.viewerId && p.status === "active" && !p.protected && !p.inMaze && p.pos === node,
  );
}

/** Mirror of the engine's re-turn rule, to offer only legal tiles. */
export function turnableTiles(view: PlayerView): { row: number; col: number }[] {
  const me = view.me!;
  const mine = me.maze;
  if (me.pos === MAZE_SQUARE) return mine.filter((t) => t.row === ENTRY_ROW && t.col === 0);
  if (!isMazeTile(me.pos)) return [];
  const [, r, c] = me.pos.split(":").map(Number) as [number, number, number];
  return mine.filter((t) => Math.abs(t.row - r) + Math.abs(t.col - c) <= 1);
}

/** Mirror of the engine rule: inside the maze, a re-turn must leave you a way back to the entrance. */
export function keepsWayBack(view: PlayerView, row: number, col: number, rotation: number): boolean {
  const me = view.me!;
  if (!isMazeTile(me.pos)) return true;
  const tiles = new Map(me.maze.map((t) => [`${t.row}:${t.col}`, t]));
  return reachableFromEntry((r, c) => {
    const t = tiles.get(`${r}:${c}`);
    if (!t) return undefined;
    return openings(t.type, r === row && c === col ? rotation : t.rotation);
  }).has(me.pos.slice(2));
}

const describeOpenings = (mask: number, turned: boolean) => [1, 2, 4, 8].filter((d) => mask & d).map((d) => sideName(d, turned)).join("–");

export function ActionPanel(p: Props) {
  const { view } = p;
  const turned = useContext(MazeTurned);
  const me = view.players.find((x) => x.id === view.viewerId)!;
  const mine = view.me!;
  const cfg = view.config;
  const arch = cfg.archetypes[me.archetype];
  const restHeal = cfg.restAmount + (arch.restBonus ?? 0);
  const restLuck = me.luck < arch.luck ? Math.min(arch.luck - me.luck, arch.luckOnRest ?? 0) : 0;
  const restLabel = `Rest (+${restHeal}${restLuck ? `, +${restLuck} Luck` : ""})`;
  const restUseless = me.stamina >= me.maxStamina && restLuck === 0;

  if (view.phase === "orient" && mine.pendingFlip) {
    const f = mine.pendingFlip;
    return (
      <div className="actions">
        <h3>Turn the tile you flipped</h3>
        <p>
          You found a <b>{f.type}</b> tile at {f.row},{f.col}. It must open to the {sideName(f.entrySide, turned)} (where you came from, marked
          with a dot).
        </p>
        <div className="rotations">
          {[0, 1, 2, 3].map((r) => {
            const ok = (openings(f.type, r) & f.entrySide) !== 0;
            return (
              <button key={r} disabled={!ok} onClick={() => p.onAction({ type: "orientTile", rotation: r })} title={`rotation ${r}`}>
                <TileIcon type={f.type} rotation={r} entrySide={f.entrySide} />
              </button>
            );
          })}
        </div>
        <BotButton {...p} />
      </div>
    );
  }

  if (view.phase === "move") {
    const targets = attackable(view, p.selectedTo ?? "");
    return (
      <div className="actions">
        <h3>You rolled {view.pendingRoll}</h3>
        <p>Click a highlighted square or maze tile to move there.</p>
        {p.selectedTo && (
          <div className="choice">
            <p>Move to {describeNode(p.selectedTo)}:</p>
            <button className="primary" onClick={() => p.onAction({ type: "move", to: p.selectedTo! })}>Move</button>
            {targets.map((t) => (
              <AttackButton key={t.id} target={t} label="Move & attack" onAttack={(stealKey) => p.onAction({ type: "move", to: p.selectedTo!, attack: t.id, ...(stealKey !== undefined ? { stealKey } : {}) })} />
            ))}
            <button className="link" onClick={() => p.setSelectedTo(null)}>cancel</button>
          </div>
        )}
        <BotButton {...p} />
      </div>
    );
  }

  // Roll phase: the turn's main choice.
  const inLair = mine.pos === LAIR;
  const here = attackable(view, mine.pos);
  const turnable = turnableTiles(view);
  const selTile = p.selectedTile ? mine.maze.find((t) => `${t.row}:${t.col}` === p.selectedTile) : undefined;
  const selTurnable = selTile && turnable.some((t) => t.row === selTile.row && t.col === selTile.col);
  const hint = mazeHint(view);

  return (
    <div className="actions">
      <h3>Your turn</h3>
      {inLair ? (
        <>
          <p>{me.wizardBeaten ? "The wizard is beaten. Try the chest?" : "You are in the lair."}</p>
          {me.wizardBeaten && <GuessChest view={view} onGuess={(keys) => p.onAction({ type: "guessChest", keys })} />}
          <div className="row">
            <button onClick={() => p.onAction({ type: "rest" })}>{restLabel}</button>
            <button onClick={() => p.onAction({ type: "leaveLair" })}>Leave the lair</button>
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <button className="primary" onClick={() => p.onAction({ type: "roll" })}>🎲 Roll</button>
            <button onClick={() => p.onAction({ type: "rest" })} disabled={restUseless}>{restLabel}</button>
          </div>
          {here.map((t) => (
            <AttackButton key={t.id} target={t} label="Attack" onAttack={(stealKey) => p.onAction({ type: "attack", target: t.id, ...(stealKey !== undefined ? { stealKey } : {}) })} />
          ))}
          {hint && <MazeHintBox hint={hint} view={view} onShow={p.setSelectedTile} />}
          {turnable.length > 0 && (
            <div className="choice">
              <p>
                Or re-turn a maze tile (costs your turn): click one of your revealed tiles{" "}
                {turnable.map((t) => `${t.row},${t.col}`).join(" / ")}.
              </p>
              {selTile && selTurnable && (
                <div className="rotations">
                  {[0, 1, 2, 3].map((r) => {
                    const cuts = !keepsWayBack(view, selTile.row, selTile.col, r);
                    return (
                      <button
                        key={r}
                        disabled={r === selTile.rotation || cuts}
                        title={cuts ? "This would cut you off from the maze entrance" : `Opens ${describeOpenings(openings(selTile.type, r), turned)}`}
                        onClick={() => p.onAction({ type: "rotateTile", row: selTile.row, col: selTile.col, rotation: r })}
                      >
                        <TileIcon type={selTile.type} rotation={r} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
      <ItemActions view={view} onAction={p.onAction} />
      <BotButton {...p} />
    </div>
  );
}

/** Free actions with carried items (they don't use up the turn). */
function ItemActions({ view, onAction }: { view: PlayerView; onAction: (a: Action) => void }) {
  const me = view.players.find((x) => x.id === view.viewerId)!;
  const peeks = view.me!.peeks;
  const unknownRooms = Object.entries(view.rooms).filter(([id, r]) => !r.revealed && !peeks[id]).map(([id]) => id);
  const [room, setRoom] = useState<string>("");
  const scrollRoom = unknownRooms.includes(room) ? room : unknownRooms[0] ?? "";
  if (!me.items.includes("provisions") && !me.items.includes("scroll")) return null;
  return (
    <div className="choice">
      <p>Items (free, your turn continues):</p>
      <div className="row">
        {me.items.includes("provisions") && (
          <button onClick={() => onAction({ type: "useItem", item: "provisions" })} disabled={me.stamina >= me.maxStamina}>
            🍖 Eat {ITEM_NAMES.provisions} (+{view.config.provisionsAmount})
          </button>
        )}
        {me.items.includes("scroll") && unknownRooms.length > 0 && (
          <>
            <button onClick={() => onAction({ type: "useItem", item: "scroll", room: scrollRoom })}>📜 Read scroll on</button>
            <select value={scrollRoom} onChange={(e) => setRoom(e.target.value)}>
              {unknownRooms.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
            </select>
          </>
        )}
      </div>
    </div>
  );
}

function BotButton(p: Props) {
  if (!p.onBotTurn) return null;
  return (
    <p>
      <button className="link" onClick={p.onBotTurn} title="Apply the scripted bot's choice for this step">
        🤖 let the bot choose this step
      </button>
    </p>
  );
}

function AttackButton({ target, label, onAttack }: { target: PublicPlayer; label: string; onAttack: (stealKey?: number) => void }) {
  const [key, setKey] = useState<number | undefined>(target.keys[0]);
  useEffect(() => setKey(target.keys[0]), [target.id, target.keys.join(",")]);
  return (
    <div className="row attack">
      <button onClick={() => onAttack(key)}>⚔ {label} {target.name}</button>
      {target.keys.length > 0 && (
        <label>
          if I win take key{" "}
          <select value={key} onChange={(e) => setKey(Number(e.target.value))}>
            {target.keys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

function GuessChest({ view, onGuess }: { view: PlayerView; onGuess: (keys: number[]) => void }) {
  const me = view.players.find((x) => x.id === view.viewerId)!;
  const need = view.config.comboSize;
  const [picked, setPicked] = useState<number[]>([]);
  const candidates = candidateCombos(view.config.keyCount, need, view.guesses);
  const usable = candidates.filter((c) => c.every((k) => me.keys.includes(k)));
  const toggle = (k: number) => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
  return (
    <div className="choice">
      <p>Pick {need} of your keys ({usable.length} of the {candidates.length} combinations still possible use only keys you hold):</p>
      <div className="row">
        {[...me.keys].sort((a, b) => a - b).map((k) => (
          <label key={k} className="keybox">
            <input type="checkbox" checked={picked.includes(k)} onChange={() => toggle(k)} /> 🔑{k}
          </label>
        ))}
      </div>
      <button className="primary" disabled={picked.length !== need} onClick={() => { onGuess(picked); setPicked([]); }}>
        Open the chest (wrong: -{view.config.wrongGuessDamage} Stamina)
      </button>
    </div>
  );
}

/** Shown when the player's revealed maze has no way forward. */
function MazeHintBox({ hint, view, onShow }: { hint: NonNullable<ReturnType<typeof mazeHint>>; view: PlayerView; onShow: (key: string | null) => void }) {
  const turned = useContext(MazeTurned);
  if (hint.kind === "rotate") {
    const t = view.me!.maze.find((x) => x.row === hint.row && x.col === hint.col);
    return (
      <div className="choice maze-hint">
        <p>
          <b>No way forward.</b> Re-turn tile {hint.row},{hint.col} so it opens {t ? describeOpenings(openings(t.type, hint.rotation), turned) : "the other way"}.
        </p>
        <button onClick={() => onShow(`${hint.row}:${hint.col}`)}>Show me</button>
      </div>
    );
  }
  const [r, c] = hint.goal.split(":");
  return (
    <div className="choice maze-hint">
      <p><b>No way forward from here.</b> Walk back to tile {r},{c}, then re-turn the next tile.</p>
    </div>
  );
}
