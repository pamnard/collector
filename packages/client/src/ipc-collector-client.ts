/**
 * IPC Collector client (#154 / #366 / #370 / #383): domain ports primary.
 *
 * Browser-safe with injectable transport (#240/#241). Node dialer: `./node`.
 * UI subscribe/stream/settings helpers orchestrate host RPCs.
 * Flat wire method names remain transitional aliases for port methods.
 */

import type {
  CollectorService,
  DashboardSnapshotPort,
} from "@collector/api";
import type {
  ServiceIpcClient,
  ServiceIpcHealthResult,
} from "@collector/service/ipc";
import { createIpcBacking } from "./create-ipc-backing.js";
import { createMemoryDashboardSnapshotPort } from "./memory-dashboard-snapshot-port.js";
import type {
  CollectorIpcClientOptions,
  CollectorIpcServiceClient,
  CollectorIpcTransportExtras,
} from "./ipc-client-types.js";

export type { ServiceIpcHealthResult };
export type {
  CollectorIpcClientOptions,
  CollectorIpcServiceClient,
  CollectorIpcTransportExtras,
};

/** Domain ports over IPC transport (#366 / #368). */
export function createCollectorIpcService(
  transport: ServiceIpcClient,
  options: CollectorIpcClientOptions = {},
): CollectorService {
  return createIpcBacking(transport, options).service;
}

/** Domain ports + transport extras for CLI/MCP (#369). */
export function createCollectorIpcServiceClient(
  transport: ServiceIpcClient,
  options: CollectorIpcClientOptions = {},
): CollectorIpcServiceClient {
  const { service, extras } = createIpcBacking(transport, options);
  return { ...service, ...extras };
}

/**
 * Dashboard snapshot slice for UiSession (#363 / #368).
 * Default is in-memory; app/Node inject disk-backed ports.
 */
export function createCollectorIpcDashboardSnapshotPort(
  _transport?: ServiceIpcClient,
  options: CollectorIpcClientOptions = {},
): DashboardSnapshotPort {
  return options.snapshot ?? createMemoryDashboardSnapshotPort();
}
