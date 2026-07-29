/**
 * IPC-backed CollectorClient factory for the UI (#240 / #366 / #368).
 * Transport is injected (Tauri proxy, mock, etc.) — no Node dialer.
 *
 * Ports are primary ({@link createIpcCollectorService}); flat
 * {@link createIpcAdapter} is a transitional shim.
 * Snapshot + thumbnail abs paths are wired from the app UiSession layer
 * (local FS), not host IPC.
 */

import type {
  ActiveVaultResult,
  CollectorService,
  CollectorServiceApi,
  DashboardSnapshotPort,
} from "@collector/api";
import {
  createCollectorIpcClient,
  createCollectorIpcService,
  type CollectorIpcClientOptions,
  type ServiceIpcClient,
} from "@collector/client";
import { createLocalDashboardSnapshotPort } from "./local-adapter";
import { createThumbnailResolveSession } from "./thumbnail-resolve-session";

export type CollectorClient = CollectorServiceApi;

function ipcUiSessionOptions(
  transport: ServiceIpcClient,
): CollectorIpcClientOptions {
  const thumbnails = createThumbnailResolveSession({
    resolveActiveVault: () =>
      transport.request("ensureActiveVault") as Promise<ActiveVaultResult>,
  });
  return {
    snapshot: createLocalDashboardSnapshotPort(),
    thumbnails,
  };
}

/** Domain ports over an injected IPC transport (#366). */
export function createIpcCollectorService(
  transport: ServiceIpcClient,
): CollectorService {
  return createCollectorIpcService(transport, ipcUiSessionOptions(transport));
}

/** Dashboard snapshot slice for flat shim / UiSession (#363 / #368) — local FS. */
export function createIpcDashboardSnapshotPort(
  _transport?: ServiceIpcClient,
): DashboardSnapshotPort {
  return createLocalDashboardSnapshotPort();
}

/**
 * Transitional flat facade. Prefer {@link createIpcCollectorService}.
 * Bootstrap (#170) still sets this until call sites migrate (#369).
 * Snapshot / thumbnails use local FS (not host wire) (#368).
 */
export function createIpcAdapter(transport: ServiceIpcClient): CollectorClient {
  return createCollectorIpcClient(transport, ipcUiSessionOptions(transport));
}
