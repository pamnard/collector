import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json";
import { collectorDevVaultPlugin } from "./src/dev/vite-plugin-dev-vault";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async ({ mode }) => {
  // Dev vault plugin reads process.env; Vite loadEnv does not always merge
  // non-VITE_ keys there — pull COLLECTOR_WEB_VAULT from .env* explicitly.
  const env = loadEnv(mode, rootDir, "");
  if (env.COLLECTOR_WEB_VAULT?.trim()) {
    process.env.COLLECTOR_WEB_VAULT = env.COLLECTOR_WEB_VAULT.trim();
  }

  // @ts-expect-error process is a nodejs global
  const host = process.env.TAURI_DEV_HOST;

  return {
    plugins: [react(), collectorDevVaultPlugin()],
    resolve: {
      // Match TypeScript customConditions — typecheck/dev resolve package source, not stale dist.
      conditions: ["@collector/source"],
      alias: {
        "@": path.resolve(rootDir, "./src"),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**", "**/packages/**/dist/**"],
      },
    },
  };
});
