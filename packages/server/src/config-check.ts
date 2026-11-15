import { DEFAULT_CONFIG, type GameConfig } from "@firetop/engine";

/**
 * Structural check for a client-supplied Partial<GameConfig>. The engine
 * merges overrides shallowly, so a nested object (roomMix, archetypes...) must
 * be given in full. Numbers must be whole and within MAX_RULE_NUMBER so a game
 * can't be set up to run forever.
 */

export const MAX_RULE_NUMBER = 100;

const STATS = { skill: 0, stamina: 0, luck: 0, restBonus: 0, luckOnRest: 0 };
const OPTIONAL = new Set(["restBonus", "luckOnRest"]);
const TEMPLATE: Record<string, unknown> = {
  ...DEFAULT_CONFIG,
  archetypes: { warrior: STATS, survivor: STATS, lucky: STATS },
};

/** Returns an error message, or null if `config` is a usable override set. */
export function checkConfig(config: unknown): string | null {
  if (!isObject(config)) return "config must be an object";
  for (const [k, v] of Object.entries(config)) {
    if (!(k in TEMPLATE)) return `config.${k} is not a rule setting`;
    const err = checkValue(v, TEMPLATE[k], `config.${k}`);
    if (err) return err;
  }
  return null;
}

function checkValue(v: unknown, t: unknown, path: string): string | null {
  if (typeof t === "number") {
    return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_RULE_NUMBER
      ? null
      : `${path} must be a whole number from 0 to ${MAX_RULE_NUMBER}`;
  }
  if (typeof t === "string") return typeof v === "string" && v.length <= 60 ? null : `${path} must be a short string`;
  if (Array.isArray(t)) {
    if (!Array.isArray(v) || v.length !== t.length) return `${path} must be an array of ${t.length}`;
    for (let i = 0; i < t.length; i++) {
      const err = checkValue(v[i], t[i], `${path}[${i}]`);
      if (err) return err;
    }
    return null;
  }
  if (isObject(t)) {
    if (!isObject(v)) return `${path} must be an object`;
    for (const k of Object.keys(v)) if (!(k in t)) return `${path}.${k} is not a rule setting`;
    for (const [k, tv] of Object.entries(t)) {
      if (!(k in v)) {
        if (OPTIONAL.has(k)) continue;
        return `${path}.${k} is missing (nested settings must be given in full)`;
      }
      const err = checkValue(v[k], tv, `${path}.${k}`);
      if (err) return err;
    }
    return null;
  }
  return `${path} is not supported`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type ConfigOverrides = Partial<GameConfig>;
