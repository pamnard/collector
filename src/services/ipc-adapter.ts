/**
 * IPC-backed CollectorService factory for the UI (#240 / #366 / #368 / #369).
 * Transport is injected (Tauri proxy, mock, etc.) — no Node dialer.
 *
 * Ports are primary ({@link createIpcCollectorService}); flat
 * {@link createIpcAdapter} is a transitional shim until #370.
 * Snapshot + thumbnail abs paths are wired from the app UiSession layer
 * (local FS), not host IPC.
 */

import type {
  ActiveVaultResult,
  CollectorService,
  CollectorServiceApi,
  DashboardSnapshotPort,
  UiSession,
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

/** UiSession for IPC cutover (#368 / #369) — local FS snapshot/thumbnails. */
export function createIpcUiSession(
  transport: ServiceIpcClient,
  service: CollectorService,
): UiSession {
  return {
    snapshot: createLocalDashboardSnapshotPort(),
    settingsSync: {
      getAppSettingsSync: () => service.settings.getAppSettingsSync(),
    },
    thumbnails: createThumbnailResolveSession({
      resolveActiveVault: () =>
        transport.request("ensureActiveVault") as Promise<ActiveVaultResult>,
    }),
  };
}

/**
 * Transitional flat facade. Prefer {@link createIpcCollectorService} +
 * {@link createIpcUiSession} (#369). Snapshot / thumbnails use local FS (#368).
 */
export function createIpcAdapter(transport: ServiceIpcClient): CollectorClient {
  return createCollectorIpcClient(transport, ipcUiSessionOptions(transport));
}
