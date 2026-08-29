/**
 * Read Vite host cutover env (`VITE_COLLECTOR_SERVICE_*`).
 * Shared by bootstrap and media URL mapping (#550 cleanup B).
 */

export type ViteCollectorServiceEnv = {
  baseUrl: string;
  token: string;
};

/** Trimmed baseUrl (no trailing slash) + token; empty strings when unset. */
export function readViteCollectorServiceEnv(): ViteCollectorServiceEnv {
  const metaEnv =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
      .env ?? {};
  const baseUrl = String(metaEnv.VITE_COLLECTOR_SERVICE_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const token = String(metaEnv.VITE_COLLECTOR_SERVICE_TOKEN ?? "").trim();
  return { baseUrl, token };
}
