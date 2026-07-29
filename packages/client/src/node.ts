/**
 * Node-only Collector IPC dialer (#154/#240/#366).
 * Use from smokes/CLI — not from the Vite UI bundle.
 */

export {
  connectCollectorIpcClient,
  createCollectorIpcClient,
  createCollectorIpcDashboardSnapshotPort,
  createCollectorIpcService,
  type CollectorIpcClient,
  type CollectorIpcClientOptions,
  type ServiceIpcHealthResult,
} from "./ipc-collector-client-node.js";
