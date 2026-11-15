import { fileURLToPath } from "node:url";
import { buildServer } from "./app.js";

/**
 * Dev entry point (`npm run server`). Settings come from the environment:
 *   FIRETOP_DB   SQLite file (default: <repo>/data/firetop.db)
 *   PORT, HOST   listen address (default 127.0.0.1:3000)
 *   PUBLIC_URL   prefix for invite links (default: relative /play/... links)
 *   FIRETOP_CLIENT_DIR  built client to serve at / (production; in dev Vite serves it)
 *   FIRETOP_VERSION     version for /api/health (the Docker build sets the git commit)
 */
const defaultDb = fileURLToPath(new URL("../../../data/firetop.db", import.meta.url));
const dbPath = process.env.FIRETOP_DB ?? defaultDb;
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const { app } = buildServer({
  dbPath,
  publicUrl: process.env.PUBLIC_URL,
  clientDir: process.env.FIRETOP_CLIENT_DIR,
  version: process.env.FIRETOP_VERSION,
  logger: true,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port, host });
  app.log.info(`database: ${dbPath}`);
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
