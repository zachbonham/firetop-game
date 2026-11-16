import { DEFAULT_CONFIG, type Archetype } from "@firetop/engine";
import { Portrait } from "../Cards.js";

export const ARCHS: Archetype[] = ["warrior", "survivor", "lucky"];

export const ABILITY: Record<Archetype, string> = {
  warrior: "best fighter",
  survivor: "deep Stamina, rests heal more",
  lucky: "rerolls lost rounds, rests win Luck back",
};

export function heroStats(a: Archetype): string {
  const st = DEFAULT_CONFIG.archetypes[a];
  return `Skill ${st.skill}, Stamina ${st.stamina}, Luck ${st.luck}`;
}

/** Pick a hero: one card per archetype with its stats and ability. */
export function HeroPicker({ value, color, onChange }: { value: Archetype; color: string; onChange: (a: Archetype) => void }) {
  return (
    <div className="hero-picker" role="radiogroup" aria-label="Hero">
      {ARCHS.map((a) => (
        <label key={a} className={`hero-option${a === value ? " picked" : ""}`}>
          <input type="radio" name="hero" value={a} checked={a === value} onChange={() => onChange(a)} />
          <Portrait archetype={a} color={color} size={40} />
          <span>
            <b>{a}</b>
            <small>{heroStats(a)}</small>
            <small>{ABILITY[a]}</small>
          </span>
        </label>
      ))}
    </div>
  );
}
