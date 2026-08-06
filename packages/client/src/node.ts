/**
 * Node-only Collector IPC dialer (#154/#240/#366/#370).
 * Use from smokes/CLI — not from the Vite UI bundle.
 */

export {
  connectCollectorHostService,
  createCollectorHostDashboardSnapshotPort,
  createCollectorHostService,
  createCollectorHostServiceClient,
  type CollectorHostClientOptions,
  type CollectorHostServiceClient,
  type ServiceHostHealthResult,
} from "./host-collector-client-node.js";
