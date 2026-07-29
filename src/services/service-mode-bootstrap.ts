/**
 * Service-mode cutover bootstrap (#170 / #369).
 *
 * Tauri default-ON: spawn supervised domain host with canonical layout,
 * dial via Tauri IPC proxy, swap CollectorService to IPC ports.
 * Opt out: COLLECTOR_SERVICE_MODE=0 (Rust env). Web / non-Tauri stays LocalAdapter.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  createIpcCollectorService,
  createIpcUiSession,
} from "./ipc-adapter";
import { setCollectorService } from "./collector-client";
import { getCollectorProfileLayout } from "./profile-layout";
import { createTauriServiceIpcTransport } from "./tauri-service-ipc-transport";

function isTauriRuntime(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    "window" in globalThis &&
    typeof (globalThis as { window?: unknown }).window === "object" &&
    (globalThis as { window?: object }).window !== null &&
    "__TAURI_INTERNALS__" in ((globalThis as { window: object }).window)
  );
}

export async function bootstrapServiceModeCutover(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }

  const enabled = await invoke<boolean>("service_mode_is_enabled");
  if (!enabled) {
    return false;
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
  return true;
}
