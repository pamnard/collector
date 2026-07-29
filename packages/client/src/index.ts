/**
 * @collector/client — browser-safe IPC CollectorClient factory (#154/#240/#366).
 * Injectable transport only — no Node dialer in this entry.
 */

export {
  createCollectorIpcClient,
  createCollectorIpcDashboardSnapshotPort,
  createCollectorIpcService,
  createCollectorIpcServiceClient,
  type CollectorIpcClient,
  type CollectorIpcClientOptions,
  type CollectorIpcServiceClient,
  type CollectorIpcTransportExtras,
  type ServiceIpcHealthResult,
} from "./ipc-collector-client.js";

export type {
  ServiceIpcClient,
  ServiceIpcRequestOptions,
} from "@collector/service/ipc";
