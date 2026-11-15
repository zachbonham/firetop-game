import { ARCHETYPES, ITEM_NAMES } from "@firetop/engine";
import { TURN_LENGTHS } from "./games.js";

/**
 * JSON schemas for request bodies. Fastify's Ajv runs with removeAdditional
 * and type coercion off (see app.ts), so anything not described here is a 400.
 * Actions are checked for shape only; the engine decides whether they are legal.
 */

const int = (minimum = 0, maximum = 1000) => ({ type: "integer", minimum, maximum }) as const;
const id = { type: "string", minLength: 1, maxLength: 40 } as const;

const actionVariant = (type: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  required: ["type", ...required],
  properties: { type: { const: type }, ...properties },
});

/** Every Action a player may send. `timeout` is server-only, so it isn't accepted here. */
export const actionSchema = {
  oneOf: [
    actionVariant("roll"),
    actionVariant("move", { to: id, attack: id, stealKey: int(1, 100) }, ["to"]),
    actionVariant("orientTile", { rotation: int(0, 3) }, ["rotation"]),
    actionVariant("rest"),
    actionVariant("attack", { target: id, stealKey: int(1, 100) }, ["target"]),
    actionVariant("guessChest", { keys: { type: "array", items: int(1, 100), maxItems: 20 } }, ["keys"]),
    actionVariant("leaveLair"),
    actionVariant("rotateTile", { row: int(0, 20), col: int(0, 20), rotation: int(0, 3) }, ["row", "col", "rotation"]),
    actionVariant(
      "setSettings",
      {
        settings: {
          type: "object",
          additionalProperties: false,
          properties: { fleeBelow: int(0, 100), autoLuck: { type: "boolean" } },
        },
      },
      ["settings"],
    ),
    actionVariant("useItem", { item: { enum: Object.keys(ITEM_NAMES) }, room: id }, ["item"]),
  ],
} as const;

export const createGameBody = {
  type: "object",
  additionalProperties: false,
  required: ["seats"],
  properties: {
    seed: { type: "integer", minimum: 0, maximum: 4294967295 },
    // 1 hour, 12 hours, 24 hours (default) or 3 days.
    turnSeconds: { enum: [...TURN_LENGTHS] },
    // Checked structurally against DEFAULT_CONFIG by checkConfig().
    config: { type: "object" },
    seats: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "archetype"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 24 },
          archetype: { enum: Object.keys(ARCHETYPES) },
          bot: { type: "boolean", default: false },
        },
      },
    },
  },
} as const;

export const actionBody = {
  type: "object",
  additionalProperties: false,
  required: ["action", "expectedSeq"],
  properties: {
    action: actionSchema,
    expectedSeq: { type: "integer", minimum: 0 },
  },
} as const;

export const gameParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,32}$" } },
} as const;

export const gameQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    since: { type: "integer", minimum: 0 },
    wait: { type: "integer", minimum: 0, maximum: 30000 },
  },
} as const;
