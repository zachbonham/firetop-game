import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Use the engine's TypeScript source directly so edits to rules hot-reload
// without rebuilding packages/engine.
const engineSrc = fileURLToPath(new URL("../engine/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@firetop/engine": engineSrc } },
  server: { port: 5173 },
});
