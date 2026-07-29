/**
 * @collector/client — browser-safe IPC CollectorService factory (#154/#240/#366/#370).
 * Injectable transport only — no Node dialer in this entry.
 */

export {
  createCollectorIpcDashboardSnapshotPort,
  createCollectorIpcService,
  createCollectorIpcServiceClient,
  type CollectorIpcClientOptions,
  type CollectorIpcServiceClient,
  type CollectorIpcTransportExtras,
  type ServiceIpcHealthResult,
} from "./ipc-collector-client.js";

export type {
  ServiceIpcClient,
  ServiceIpcRequestOptions,
} from "@collector/service/ipc";
