/**
 * IPC-backed CollectorClient factory for the UI (#240 / #366).
 * Transport is injected (Tauri proxy, mock, etc.) — no Node dialer.
 *
 * Ports are primary ({@link createIpcCollectorService}); flat
 * {@link createIpcAdapter} is a transitional shim.
 */

import type {
  CollectorService,
  CollectorServiceApi,
  DashboardSnapshotPort,
} from "@collector/api";
import {
  createCollectorIpcClient,
  createCollectorIpcDashboardSnapshotPort,
  createCollectorIpcService,
  type ServiceIpcClient,
} from "@collector/client";

export type CollectorClient = CollectorServiceApi;

/** Domain ports over an injected IPC transport (#366). */
export function createIpcCollectorService(
  transport: ServiceIpcClient,
): CollectorService {
  return createCollectorIpcService(transport);
}

/** Dashboard snapshot slice for flat shim / UiSession (#363 / #366). */
export function createIpcDashboardSnapshotPort(
  transport: ServiceIpcClient,
): DashboardSnapshotPort {
  return createCollectorIpcDashboardSnapshotPort(transport);
}

/**
 * Transitional flat facade. Prefer {@link createIpcCollectorService}.
 * Bootstrap (#170) still sets this until call sites migrate (#369).
 */
export function createIpcAdapter(transport: ServiceIpcClient): CollectorClient {
  return createCollectorIpcClient(transport);
}
