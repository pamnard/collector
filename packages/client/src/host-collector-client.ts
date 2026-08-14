/**
 * Host Collector client (#154 / #366 / #370 / #383): domain ports primary.
 *
 * Browser-safe with injectable transport (#240/#241). Node dialer: `./node` (HTTP).
 * UI subscribe/stream/settings helpers orchestrate host RPCs.
 * Flat wire method names remain transitional aliases for port methods.
 */

import type {
  CollectorService,
  DashboardSnapshotPort,
} from "@collector/api";
import type {
  HostWireClient,
  ServiceHostHealthResult,
} from "@collector/service/wire";
import { createHostBacking } from "./create-host-backing.js";
import { createMemoryDashboardSnapshotPort } from "./memory-dashboard-snapshot-port.js";
import type {
  CollectorHostClientOptions,
  CollectorHostServiceClient,
  CollectorHostTransportExtras,
} from "./host-client-types.js";

export type { ServiceHostHealthResult };
export type {
  CollectorHostClientOptions,
  CollectorHostServiceClient,
  CollectorHostTransportExtras,
};

/** Domain ports over host transport (#366 / #368). */
export function createCollectorHostService(
  transport: HostWireClient,
  options: CollectorHostClientOptions = {},
): CollectorService {
  return createHostBacking(transport, options).service;
}

/** Domain ports + transport extras for CLI/MCP (#369). */
export function createCollectorHostServiceClient(
  transport: HostWireClient,
  options: CollectorHostClientOptions = {},
): CollectorHostServiceClient {
  const { service, extras } = createHostBacking(transport, options);
  return { ...service, ...extras };
}

/**
 * Dashboard snapshot slice for UiSession (#363 / #368).
 * Default is in-memory; app/Node inject disk-backed ports.
 */
export function createCollectorHostDashboardSnapshotPort(
  _transport?: HostWireClient,
  options: CollectorHostClientOptions = {},
): DashboardSnapshotPort {
  return options.snapshot ?? createMemoryDashboardSnapshotPort();
}
