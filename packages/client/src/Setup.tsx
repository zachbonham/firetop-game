import { useState } from "react";
import { BOARD, DEFAULT_CONFIG, ITEM_NAMES, type Archetype, type GameConfig, type ItemId } from "@firetop/engine";
import { fromSave, type Seat, type Session, type SessionSetup } from "./session.js";
import { seatColor } from "./describe.js";
import { downloadJson, readJsonFile } from "./files.js";

const ARCHS: Archetype[] = ["warrior", "survivor", "lucky"];
const NAMES = ["Ann", "Bo", "Cy", "Di"];

interface Props {
  initial: SessionSetup | null;
  onStart: (setup: SessionSetup) => void;
  onLoad: (session: Session) => void;
}

export function defaultSetup(): SessionSetup {
  return {
    seed: randomSeed(),
    seats: [
      { id: "p1", name: "Ann", archetype: "warrior", bot: false },
      { id: "p2", name: "Bo", archetype: "lucky", bot: true },
    ],
    config: {},
  };
}

function randomSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

/** Only the keys that differ from DEFAULT_CONFIG, so saves and sim overrides stay small. */
export function configDiff(full: GameConfig): Partial<GameConfig> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) {
    if (JSON.stringify(v) !== JSON.stringify(DEFAULT_CONFIG[k as keyof GameConfig])) out[k] = v;
  }
  return out as Partial<GameConfig>;
}

export function Setup({ initial, onStart, onLoad }: Props) {
  const [setup, setSetup] = useState<SessionSetup>(() => initial ?? defaultSetup());
  const [cfg, setCfg] = useState<GameConfig>(() => structuredClone({ ...DEFAULT_CONFIG, ...setup.config }));
  const [error, setError] = useState<string | null>(null);

  const seats = setup.seats;
  const setSeat = (i: number, patch: Partial<Seat>) =>
    setSetup({ ...setup, seats: seats.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addSeat = () => {
    const n = seats.length;
    setSetup({ ...setup, seats: [...seats, { id: `p${n + 1}`, name: NAMES[n] ?? `P${n + 1}`, archetype: ARCHS[n % 3]!, bot: true }] });
  };
  const removeSeat = (i: number) =>
    setSetup({ ...setup, seats: seats.filter((_, j) => j !== i).map((s, j) => ({ ...s, id: `p${j + 1}` })) });

  const mixTotal = Object.values(cfg.roomMix).reduce((a, b) => a + b, 0);
  const keyRooms = cfg.roomMix.monster + cfg.roomMix.treasure;
  const problems: string[] = [];
  if (mixTotal !== BOARD.rooms.length) problems.push(`room mix must add up to ${BOARD.rooms.length} (now ${mixTotal})`);
  const deckSize = Object.values(cfg.treasureDeck).reduce((a, b) => a + b, 0);
  if (deckSize < cfg.roomMix.treasure) problems.push(`treasure deck needs at least ${cfg.roomMix.treasure} items (one per treasure room)`);
  if (keyRooms < cfg.keyCount) problems.push(`need at least ${cfg.keyCount} monster + treasure rooms for the keys`);
  if (cfg.comboSize > cfg.keyCount) problems.push("combination can't be bigger than the number of keys");
  if (cfg.trapDamage[0] > cfg.trapDamage[1]) problems.push("trap damage min is above max");
  if (seats.some((s) => !s.name.trim())) problems.push("every seat needs a name");

  const start = () => {
    setError(null);
    onStart({ ...setup, config: configDiff(cfg) });
  };

  const load = async () => {
    try {
      const data = await readJsonFile();
      if (data === null) return;
      onLoad(fromSave(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadConfig = async () => {
    try {
      const data = (await readJsonFile()) as Partial<GameConfig> | null;
      if (data) setCfg(structuredClone({ ...DEFAULT_CONFIG, ...data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const num = (label: string, value: number, set: (v: number) => void, min = 0) => (
    <label className="num">
      <span>{label}</span>
      <input type="number" min={min} value={value} onChange={(e) => set(Math.max(min, Math.floor(Number(e.target.value) || 0)))} />
    </label>
  );
  const upd = (patch: Partial<GameConfig>) => setCfg({ ...cfg, ...patch });
  const diff = configDiff(cfg);

  return (
    <div className="setup">
      <h1>Firetop Mountain <small>local test board</small></h1>

      <section className="card">
        <h2>Players</h2>
        <table className="seats">
          <thead>
            <tr><th /><th>Name</th><th>Archetype</th><th>Controlled by</th><th /></tr>
          </thead>
          <tbody>
            {seats.map((s, i) => (
              <tr key={i}>
                <td><span className="swatch" style={{ background: seatColor(i) }} /></td>
                <td><input value={s.name} onChange={(e) => setSeat(i, { name: e.target.value })} /></td>
                <td>
                  <select value={s.archetype} onChange={(e) => setSeat(i, { archetype: e.target.value as Archetype })}>
                    {ARCHS.map((a) => <option key={a} value={a}>{a} ({cfg.archetypes[a].skill}/{cfg.archetypes[a].stamina}/{cfg.archetypes[a].luck})</option>)}
                  </select>
                </td>
                <td>
                  <select value={s.bot ? "bot" : "human"} onChange={(e) => setSeat(i, { bot: e.target.value === "bot" })}>
                    <option value="human">Human (hot-seat)</option>
                    <option value="bot">Bot</option>
                  </select>
                </td>
                <td>{seats.length > 2 && <button className="link" onClick={() => removeSeat(i)}>remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {seats.length < 4 && <button onClick={addSeat}>+ Add player</button>}
        <div className="row">
          <label className="num">
            <span>Seed</span>
            <input type="number" value={setup.seed} onChange={(e) => setSetup({ ...setup, seed: Math.floor(Number(e.target.value) || 0) })} />
          </label>
          <button onClick={() => setSetup({ ...setup, seed: randomSeed() })}>🎲 New seed</button>
        </div>
      </section>

      <section className="card">
        <h2>Rules <small>(GameConfig overrides for this game)</small></h2>
        <div className="grid">
          <fieldset>
            <legend>Archetypes (Skill / Stamina / Luck)</legend>
            {ARCHS.map((a) => (
              <div key={a} className="arch-row">
                <b>{a}</b>
                {(["skill", "stamina", "luck"] as const).map((stat) =>
                  <input
                    key={stat}
                    type="number"
                    min={stat === "stamina" ? 1 : 0}
                    title={stat}
                    value={cfg.archetypes[a][stat]}
                    onChange={(e) => upd({ archetypes: { ...cfg.archetypes, [a]: { ...cfg.archetypes[a], [stat]: Math.max(0, Math.floor(Number(e.target.value) || 0)) } } })}
                  />,
                )}
              </div>
            ))}
          </fieldset>
          <fieldset>
            <legend>Wizard</legend>
            {num("Skill", cfg.wizard.skill, (v) => upd({ wizard: { ...cfg.wizard, skill: v } }))}
            {num("Stamina", cfg.wizard.stamina, (v) => upd({ wizard: { ...cfg.wizard, stamina: v } }), 1)}
            {num("Wrong guess damage", cfg.wrongGuessDamage, (v) => upd({ wrongGuessDamage: v }))}
          </fieldset>
          <fieldset>
            <legend>Rooms (must total {BOARD.rooms.length})</legend>
            {(["monster", "treasure", "trap", "empty"] as const).map((k) =>
              <span key={k}>{num(k, cfg.roomMix[k], (v) => upd({ roomMix: { ...cfg.roomMix, [k]: v } }))}</span>,
            )}
            {num("Trap damage min", cfg.trapDamage[0], (v) => upd({ trapDamage: [v, cfg.trapDamage[1]] }))}
            {num("Trap damage max", cfg.trapDamage[1], (v) => upd({ trapDamage: [cfg.trapDamage[0], v] }))}
          </fieldset>
          <fieldset>
            <legend>Treasure deck (one item per treasure room)</legend>
            {(Object.keys(ITEM_NAMES) as ItemId[]).map((item) =>
              <span key={item}>{num(ITEM_NAMES[item], cfg.treasureDeck[item], (v) => upd({ treasureDeck: { ...cfg.treasureDeck, [item]: v } }))}</span>,
            )}
          </fieldset>
          <fieldset>
            <legend>Item effects</legend>
            {num("Potion of Skill: +Skill", cfg.items.skillPotion, (v) => upd({ items: { ...cfg.items, skillPotion: v } }))}
            {num("Potion of Luck: +Luck", cfg.items.luckPotion, (v) => upd({ items: { ...cfg.items, luckPotion: v } }))}
            {num("Sword: +Skill vs monsters", cfg.items.swordSkill, (v) => upd({ items: { ...cfg.items, swordSkill: v } }))}
            {num("Shield: damage blocked", cfg.items.shieldBlock, (v) => upd({ items: { ...cfg.items, shieldBlock: v } }))}
            {num("Provisions heal", cfg.provisionsAmount, (v) => upd({ provisionsAmount: v }))}
          </fieldset>
          <fieldset>
            <legend>Turn &amp; combat</legend>
            {num("Rest heals", cfg.restAmount, (v) => upd({ restAmount: v }))}
            {num("Combat damage", cfg.combatDamage, (v) => upd({ combatDamage: v }), 1)}
            {num("Default flee below", cfg.defaultFleeBelow, (v) => upd({ defaultFleeBelow: v }))}
            {num("Keys", cfg.keyCount, (v) => upd({ keyCount: v }), 1)}
            {num("Keys in combination", cfg.comboSize, (v) => upd({ comboSize: v }), 1)}
            {num("Missed turns before removal", cfg.maxMissedTurns, (v) => upd({ maxMissedTurns: v }), 1)}
          </fieldset>
        </div>
        <div className="row">
          <button onClick={() => setCfg(structuredClone(DEFAULT_CONFIG))}>Reset to defaults</button>
          <button onClick={loadConfig}>Load config…</button>
          <button onClick={() => downloadJson("firetop-config.json", diff)} title="Use with: npm run sim -- 200 --config firetop-config.json">
            Export for sim
          </button>
          <code className="diff">{Object.keys(diff).length ? JSON.stringify(diff) : "(defaults)"}</code>
        </div>
      </section>

      {problems.length > 0 && <ul className="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={problems.length > 0} onClick={start}>Start game</button>
        <button onClick={load}>Load saved game…</button>
      </div>
    </div>
  );
}
