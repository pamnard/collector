import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["@collector/source"],
  },
  ssr: {
    resolve: {
      conditions: ["@collector/source"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      // Avoid downloading HF weights during unit/integration tests (#413).
      COLLECTOR_EMBEDDINGS_ENGINE: "fake",
    },
  },
});
