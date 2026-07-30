/**
 * Service-mode cutover bootstrap (#170 / #332 / #369).
 *
 * Tauri: spawn supervised domain host, dial via Tauri IPC proxy, swap to IPC.
 * Opt out (COLLECTOR_SERVICE_MODE=0) throws — no zombie LocalAdapter.
 * Web / non-Tauri returns "web"; caller installs DevMock.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  createIpcCollectorService,
  createIpcUiSession,
} from "./ipc-adapter";
import { setCollectorService } from "./collector-client";
import { getCollectorProfileLayout } from "./profile-layout";
import { createTauriServiceIpcTransport } from "./tauri-service-ipc-transport";

export type BootstrapCutoverResult = "ipc" | "web";

function isTauriRuntime(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    "window" in globalThis &&
    typeof (globalThis as { window?: unknown }).window === "object" &&
    (globalThis as { window?: object }).window !== null &&
    "__TAURI_INTERNALS__" in ((globalThis as { window: object }).window)
  );
}

export async function bootstrapServiceModeCutover(): Promise<BootstrapCutoverResult> {
  if (!isTauriRuntime()) {
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
