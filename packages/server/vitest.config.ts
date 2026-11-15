import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Like the client, use the engine's TypeScript source directly (no engine build step).
const engineSrc = fileURLToPath(new URL("../engine/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@firetop/engine": engineSrc } },
  test: { include: ["test/**/*.test.ts"] },
});
