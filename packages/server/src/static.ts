import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { FastifyInstance } from "fastify";

/**
 * Serve the built client (packages/client/dist) from the same origin as the
 * API, so production needs one process and no CORS. Anything that isn't a
 * file falls back to index.html (the client routes /online, /play/<id> itself).
 * No extra dependency: the client is a handful of files.
 */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

export function serveClient(app: FastifyInstance, dir: string): void {
  const root = normalize(dir.endsWith(sep) ? dir : dir + sep);

  app.setNotFoundHandler(async (req, reply) => {
    const url = (req.raw.url ?? "/").split("?")[0]!;
    if (url.startsWith("/api/")) return reply.status(404).send({ error: "no such endpoint", code: "not_found" });
    if (req.method !== "GET" && req.method !== "HEAD") return reply.status(405).send({ error: "method not allowed", code: "bad_request" });

    let rel: string;
    try {
      rel = decodeURIComponent(url);
    } catch {
      return reply.status(400).send({ error: "bad path", code: "bad_request" });
    }
    const file = normalize(join(root, rel));
    // Never serve anything outside the client folder (e.g. /../../data/firetop.db).
    if (file.startsWith(root) && rel !== "/" && (await isFile(file))) {
      const hashed = rel.startsWith("/assets/");
      reply.header("cache-control", hashed ? "public, max-age=31536000, immutable" : "no-cache");
      reply.type(TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
      return reply.send(await readFile(file));
    }
    // Client-side route: the app shell. Never cached, so a deploy shows up on the next load.
    reply.header("cache-control", "no-cache");
    reply.type(TYPES[".html"]!);
    return reply.send(await readFile(join(root, "index.html")));
  });
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
