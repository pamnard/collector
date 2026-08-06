/**
 * Service-mode cutover bootstrap (#170 / #332 / #369 / #551 / #555).
 *
 * 1. Both VITE_COLLECTOR_SERVICE_* → HTTP host (dev:host).
 * 2. Else GET /api/ui-bootstrap on same origin → packaged host+UI (#555).
 * 3. Else "web" (DevMock).
 */

import { createHttpUiCutover } from "./http-adapter";
import { setCollectorService } from "./collector-client";
import { setHostMediaCredentials } from "../utils/asset-src";
import { readViteCollectorServiceEnv } from "./vite-collector-service-env";

export type BootstrapCutoverResult = "web" | "host";

export type UiBootstrapPayload = {
  baseUrl: string;
  token: string;
  wsEventsUrl: string;
};

/** Fetch packaged-host bootstrap; null when endpoint missing or not OK. */
export async function fetchUiBootstrap(
  fetchImpl: typeof fetch = fetch,
): Promise<UiBootstrapPayload | null> {
  const response = await fetchImpl("/api/ui-bootstrap", {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `ui-bootstrap failed: HTTP ${response.status} (#555)`,
    );
  }
  const body = (await response.json()) as Partial<UiBootstrapPayload>;
  const baseUrl = String(body.baseUrl ?? "").trim();
  const token = String(body.token ?? "").trim();
  const wsEventsUrl = String(body.wsEventsUrl ?? "").trim();
  if (!baseUrl || !token || !wsEventsUrl) {
    throw new Error("ui-bootstrap response missing baseUrl/token/wsEventsUrl (#555)");
  }
  return { baseUrl, token, wsEventsUrl };
}

async function installHttpHost(
  baseUrl: string,
  token: string,
): Promise<"host"> {
  const { service, session } = await createHttpUiCutover(baseUrl, token);
  setHostMediaCredentials(baseUrl, token);
  setCollectorService(service, session);
  return "host";
}

export async function bootstrapServiceModeCutover(): Promise<BootstrapCutoverResult> {
  const { baseUrl, token } = readViteCollectorServiceEnv();
  const hasBase = baseUrl.length > 0;
  const hasToken = token.length > 0;
  if (hasBase !== hasToken) {
    throw new Error(
      "VITE_COLLECTOR_SERVICE_BASE_URL and VITE_COLLECTOR_SERVICE_TOKEN must both be set or both empty (#551)",
    );
  }
  if (hasBase && hasToken) {
    return installHttpHost(baseUrl, token);
  }

  const bootstrap = await fetchUiBootstrap();
  if (bootstrap) {
    return installHttpHost(bootstrap.baseUrl, bootstrap.token);
  }

  return "web";
}
