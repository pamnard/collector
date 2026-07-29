/**
 * Node-only Collector IPC dialer (#154/#240/#366).
 * Use from smokes/CLI — not from the Vite UI bundle.
 */

export {
  connectCollectorIpcClient,
  connectCollectorIpcService,
  createCollectorIpcClient,
  createCollectorIpcDashboardSnapshotPort,
  createCollectorIpcService,
  createCollectorIpcServiceClient,
  type CollectorIpcClient,
  type CollectorIpcClientOptions,
  type CollectorIpcServiceClient,
  type ServiceIpcHealthResult,
} from "./ipc-collector-client-node.js";
