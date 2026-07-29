/**
 * Node-only Collector IPC dialer (#154/#240/#366/#370).
 * Use from smokes/CLI — not from the Vite UI bundle.
 */

export {
  connectCollectorIpcService,
  createCollectorIpcDashboardSnapshotPort,
  createCollectorIpcService,
  createCollectorIpcServiceClient,
  type CollectorIpcClientOptions,
  type CollectorIpcServiceClient,
  type ServiceIpcHealthResult,
} from "./ipc-collector-client-node.js";
