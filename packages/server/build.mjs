/**
 * Production bundle: one ESM file (dist/server.mjs) with the engine source and
 * Fastify inlined, so the Docker image needs no node_modules at all.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const engineSrc = fileURLToPath(new URL("../engine/src/index.ts", import.meta.url));

await build({
  entryPoints: [fileURLToPath(new URL("src/main.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("dist/server.mjs", import.meta.url)),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  alias: { "@firetop/engine": engineSrc },
  // Some of Fastify's dependencies are CommonJS and call require().
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "info",
});
