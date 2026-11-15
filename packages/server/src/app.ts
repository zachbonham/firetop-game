import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { RULES_VERSION, type Action } from "@firetop/engine";
import { Db } from "./db.js";
import { ApiError, GameStore, type NewGameInput, type StoreOptions } from "./games.js";
import { actionBody, createGameBody, gameParams, gameQuery } from "./schemas.js";
import { serveClient } from "./static.js";

export interface ServerOptions extends StoreOptions {
  /** SQLite file path, or ":memory:". */
  dbPath: string;
  /** Prefix for invite links, e.g. "https://firetop.example". Default: relative links. */
  publicUrl?: string;
  /** Default long-poll wait when `since` is given without `wait` (ms). */
  defaultWaitMs?: number;
  logger?: boolean;
  /** How often to time out overdue turns (ms). Default 60 000; 0 turns the sweeper off. */
  sweepIntervalMs?: number;
  /** Built client to serve at / (production). Unset in dev, where Vite serves it. */
  clientDir?: string;
  /** Build version reported by /api/health (e.g. the git commit). */
  version?: string;
}

export interface Server {
  app: FastifyInstance;
  store: GameStore;
  db: Db;
}

/** Longest a long-poll may hold a request open. */
export const MAX_WAIT_MS = 30_000;

export function buildServer(opts: ServerOptions): Server {
  const db = new Db(opts.dbPath);
  const store = new GameStore(db, opts);
  const publicUrl = (opts.publicUrl ?? "").replace(/\/+$/, "");
  const defaultWaitMs = Math.min(opts.defaultWaitMs ?? 25_000, MAX_WAIT_MS);

  const app = Fastify({
    logger: opts.logger ?? false,
    // Keep Ajv from silently dropping unknown properties (it misbehaves with oneOf):
    // unknown properties are a 400 instead.
    ajv: { customOptions: { removeAdditional: false } },
    bodyLimit: 64 * 1024,
  });
  // The turn timer: time out overdue human turns every minute.
  const sweepMs = opts.sweepIntervalMs ?? 60_000;
  const sweep = () => {
    try {
      const n = store.sweep();
      if (n) app.log.info(`timed out ${n} turn${n === 1 ? "" : "s"}`);
    } catch (e) {
      app.log.error(e);
    }
  };
  const sweeper = sweepMs > 0 ? setInterval(sweep, sweepMs) : null;
  sweeper?.unref();
  // Also sweep right away: on Fly the machine sleeps when nobody is connected, so deadlines
  // that passed while it was stopped are applied as soon as someone wakes it.
  if (sweepMs > 0) setTimeout(sweep, 0).unref();
  app.addHook("onClose", async () => {
    if (sweeper) clearInterval(sweeper);
    db.close();
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      if (err.status >= 500) req.log.error(err);
      return reply.status(err.status).send({ error: err.message, code: err.code });
    }
    const e = err as { validation?: unknown; statusCode?: number; message: string };
    if (e.validation) return reply.status(400).send({ error: e.message, code: "bad_request" });
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: e.message, code: "bad_request" });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "internal error", code: "internal" });
  });

  app.get("/api/health", async () => ({ ok: true, rulesVersion: RULES_VERSION, version: opts.version ?? "dev" }));
  if (opts.clientDir) serveClient(app, opts.clientDir);

  app.post<{ Body: NewGameInput }>("/api/games", { schema: { body: createGameBody } }, async (req, reply) => {
    const created = store.create(req.body);
    reply.status(201);
    return {
      gameId: created.gameId,
      rulesVersion: RULES_VERSION,
      // The token is in the URL fragment, which browsers never send to the server.
      invites: created.tokens.map((t) => ({
        playerId: t.playerId,
        name: t.name,
        url: `${publicUrl}/play/${created.gameId}#${t.token}`,
      })),
    };
  });

  app.get<{ Params: { id: string }; Querystring: { since?: number; wait?: number } }>(
    "/api/games/:id",
    { schema: { params: gameParams, querystring: gameQuery } },
    async (req, reply) => {
      const { game, seat } = store.authenticate(req.params.id, bearer(req));
      const { since, wait } = req.query;
      if (since !== undefined && since >= game.seq) {
        const abort = new AbortController();
        const onClose = () => abort.abort();
        reply.raw.once("close", onClose);
        await store.waitForChange(req.params.id, since, Math.min(wait ?? defaultWaitMs, MAX_WAIT_MS), abort.signal);
        reply.raw.off("close", onClose);
      }
      return store.response(store.load(req.params.id), seat.playerId);
    },
  );

  // Public game log: anyone with the game id (no seat token). Never includes private entries.
  app.get<{ Params: { id: string } }>("/api/games/:id/log", { schema: { params: gameParams } }, async (req) =>
    store.publicLog(req.params.id));

  app.post<{ Params: { id: string }; Body: { action: Action; expectedSeq: number } }>(
    "/api/games/:id/actions",
    { schema: { params: gameParams, body: actionBody } },
    async (req) => {
      const { seat } = store.authenticate(req.params.id, bearer(req));
      const game = store.act(req.params.id, seat.playerId, req.body.action, req.body.expectedSeq);
      return store.response(game, seat.playerId);
    },
  );

  return { app, store, db };
}

function bearer(req: FastifyRequest): string | undefined {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? "");
  return m?.[1];
}
