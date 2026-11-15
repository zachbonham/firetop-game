import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const engineSrc = fileURLToPath(new URL("../engine/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@firetop/engine": engineSrc } },
  test: { include: ["test/**/*.test.ts"] },
});
