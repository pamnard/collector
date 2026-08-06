/**
 * Service-mode cutover bootstrap (#170 / #332 / #369 / #551).
 *
 * Tauri: spawn supervised domain host, dial via Tauri proxy, swap to host ports.
 * Opt out (COLLECTOR_SERVICE_MODE=0) throws — no zombie LocalAdapter.
 * Browser: both VITE_COLLECTOR_SERVICE_* → HTTP host; neither → "web" (DevMock);
 * exactly one → fail fast.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  createIpcCollectorService,
  createIpcUiSession,
} from "./ipc-adapter";
import { createHttpUiCutover } from "./http-adapter";
import { setCollectorService } from "./collector-client";
import { getCollectorProfileLayout } from "./profile-layout";
import { createTauriServiceIpcTransport } from "./tauri-service-ipc-transport";

export type BootstrapCutoverResult = "ipc" | "web" | "host";

function isTauriRuntime(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    "window" in globalThis &&
    typeof (globalThis as { window?: unknown }).window === "object" &&
    (globalThis as { window?: object }).window !== null &&
    "__TAURI_INTERNALS__" in ((globalThis as { window: object }).window)
  );
}

function readViteHostEnv(): { baseUrl: string; token: string } {
  const env = import.meta.env as Record<string, string | undefined>;
  const baseUrl = String(env.VITE_COLLECTOR_SERVICE_BASE_URL ?? "").trim();
  const token = String(env.VITE_COLLECTOR_SERVICE_TOKEN ?? "").trim();
  return { baseUrl, token };
}

export async function bootstrapServiceModeCutover(): Promise<BootstrapCutoverResult> {
  if (!isTauriRuntime()) {
    const { baseUrl, token } = readViteHostEnv();
    const hasBase = baseUrl.length > 0;
    const hasToken = token.length > 0;
    if (hasBase !== hasToken) {
      throw new Error(
        "VITE_COLLECTOR_SERVICE_BASE_URL and VITE_COLLECTOR_SERVICE_TOKEN must both be set or both empty (#551)",
      );
    }
    if (hasBase && hasToken) {
      const { service, session } = await createHttpUiCutover(baseUrl, token);
      setCollectorService(service, session);
      return "host";
    }
    return "web";
  }

  const enabled = await invoke<boolean>("service_mode_is_enabled");
  if (!enabled) {
    throw new Error(
      "COLLECTOR_SERVICE_MODE=0 is unsupported (#332); desktop UI requires service IPC",
    );
  }

  const layout = await getCollectorProfileLayout();
  const ipcPath = await invoke<string>("service_mode_bootstrap", {
    dataDir: layout.dataDir,
    configDir: layout.configDir,
  });
  const transport = await createTauriServiceIpcTransport(
    ipcPath,
    layout.dataDir,
  );
  const service = createIpcCollectorService(transport);
  setCollectorService(service, createIpcUiSession(transport, service));
  return "ipc";
}
