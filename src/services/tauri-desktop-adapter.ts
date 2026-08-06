/**
 * Tauri-desktop CollectorService factory for the UI (#240 / #366 / #368 / #369 / #370).
 * Transport is injected (Tauri proxy, mock, etc.) — no Node dialer.
 *
 * Ports are primary ({@link createTauriDesktopCollectorService}).
 * Snapshot + thumbnail abs paths are wired from the app UiSession layer
 * (local FS), not host wire.
 */

import type {
  ActiveVaultResult,
  CollectorService,
  DashboardSnapshotPort,
  UiSession,
} from "@collector/api";
import {
  createCollectorHostService,
  type CollectorHostClientOptions,
  type HostWireClient,
} from "@collector/client";
import { createThumbnailResolveSession } from "./thumbnail-resolve-session";
import { createUiDashboardSnapshotPort } from "./ui-dashboard-snapshot-port";

function tauriDesktopUiSessionOptions(
  transport: HostWireClient,
): CollectorHostClientOptions {
  const thumbnails = createThumbnailResolveSession({
    resolveActiveVault: () =>
      transport.request("ensureActiveVault") as Promise<ActiveVaultResult>,
  });
  return {
    snapshot: createUiDashboardSnapshotPort(),
    thumbnails,
  };
}

/** Domain ports over an injected host wire transport (#366). */
export function createTauriDesktopCollectorService(
  transport: HostWireClient,
): CollectorService {
  return createCollectorHostService(transport, tauriDesktopUiSessionOptions(transport));
}

/** Dashboard snapshot slice for UiSession (#363 / #368) — local FS. */
export function createTauriDesktopDashboardSnapshotPort(
  _transport?: HostWireClient,
): DashboardSnapshotPort {
  return createUiDashboardSnapshotPort();
}

/** UiSession for Tauri desktop cutover (#368 / #369) — local FS snapshot/thumbnails. */
export function createTauriDesktopUiSession(
  transport: HostWireClient,
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
