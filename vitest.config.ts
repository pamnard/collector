import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Root UI regression tests (RTL + jsdom).
 * Most lib suites stay on `node --test`; this file also runs lib tests that
 * need Vite resolve (extensionless imports / package aliases).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@collector/shared": path.resolve(
        __dirname,
        "packages/shared/src/index.ts",
      ),
      "@collector/api": path.resolve(__dirname, "packages/api/src/index.ts"),
      "@collector/core": path.resolve(__dirname, "packages/core/src/index.ts"),
    },
    conditions: ["@collector/source"],
  },
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.tsx",
      "src/lib/related-semantic-items.test.ts",
    ],
    setupFiles: ["src/test/setup-rtl.ts"],
    css: false,
  },
});
