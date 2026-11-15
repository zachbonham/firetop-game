import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Use the engine's TypeScript source directly so edits to rules hot-reload
// without rebuilding packages/engine.
const engineSrc = fileURLToPath(new URL("../engine/src/index.ts", import.meta.url));
const autosaveDir = fileURLToPath(new URL("../../playtests/autosave/", import.meta.url));

function gitCommit(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() ? "-dirty" : "";
    return sha + dirty;
  } catch {
    return "unknown";
  }
}

/**
 * Dev-server only: POST /__autosave/<name> writes the body to
 * playtests/autosave/<name>.json, so every local game is on disk without
 * anyone having to remember to press Save.
 */
function autosave(): Plugin {
  return {
    name: "firetop-autosave",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__autosave/", (req, res) => {
        const name = decodeURIComponent((req.url ?? "").replace(/^\//, ""));
        if (req.method !== "POST" || !/^[\w.-]{1,100}$/.test(name)) {
          res.statusCode = 400;
          res.end("bad autosave request");
          return;
        }
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => (body += chunk));
        req.on("end", () => {
          try {
            JSON.parse(body);
            mkdirSync(autosaveDir, { recursive: true });
            writeFileSync(`${autosaveDir}${name}.json`, body);
            res.end(`playtests/autosave/${name}.json`);
          } catch (e) {
            res.statusCode = 500;
            res.end(e instanceof Error ? e.message : String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), autosave()],
  resolve: { alias: { "@firetop/engine": engineSrc } },
  define: { __GIT_COMMIT__: JSON.stringify(gitCommit()) },
  server: {
    port: 5173,
    // Online games: the API server (npm run server) listens on 3000.
    proxy: { "/api": { target: `http://127.0.0.1:${process.env.FIRETOP_API_PORT ?? 3000}`, changeOrigin: true } },
  },
});
