/**
 * IPC-backed CollectorService factory for the UI (#240 / #366 / #368 / #369 / #370).
 * Transport is injected (Tauri proxy, mock, etc.) — no Node dialer.
 *
 * Ports are primary ({@link createIpcCollectorService}).
 * Snapshot + thumbnail abs paths are wired from the app UiSession layer
 * (local FS), not host IPC.
 */

import type {
  ActiveVaultResult,
  CollectorService,
  DashboardSnapshotPort,
  UiSession,
} from "@collector/api";
import {
  createCollectorIpcService,
  type CollectorIpcClientOptions,
  type ServiceIpcClient,
} from "@collector/client";
import { createThumbnailResolveSession } from "./thumbnail-resolve-session";
import { createUiDashboardSnapshotPort } from "./ui-dashboard-snapshot-port";

function ipcUiSessionOptions(
  transport: ServiceIpcClient,
): CollectorIpcClientOptions {
  const thumbnails = createThumbnailResolveSession({
    resolveActiveVault: () =>
      transport.request("ensureActiveVault") as Promise<ActiveVaultResult>,
  });
  return {
    snapshot: createUiDashboardSnapshotPort(),
    thumbnails,
  };
}

/** Domain ports over an injected IPC transport (#366). */
export function createIpcCollectorService(
  transport: ServiceIpcClient,
): CollectorService {
  return createCollectorIpcService(transport, ipcUiSessionOptions(transport));
}

/** Dashboard snapshot slice for UiSession (#363 / #368) — local FS. */
export function createIpcDashboardSnapshotPort(
  _transport?: ServiceIpcClient,
): DashboardSnapshotPort {
  return createUiDashboardSnapshotPort();
}

/** UiSession for IPC cutover (#368 / #369) — local FS snapshot/thumbnails. */
export function createIpcUiSession(
  transport: ServiceIpcClient,
  service: CollectorService,
): UiSession {
  return {
    snapshot: createUiDashboardSnapshotPort(),
    settingsSync: {
      getAppSettingsSync: () => service.settings.getAppSettingsSync(),
    },
    thumbnails: createThumbnailResolveSession({
      resolveActiveVault: () =>
        transport.request("ensureActiveVault") as Promise<ActiveVaultResult>,
    }),
  };
}
