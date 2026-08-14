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
  },
});
