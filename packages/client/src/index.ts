/**
 * @collector/client — browser-safe CollectorService factories (#154/#240/#366/#370/#551).
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

export {
  createHttpCollectorService,
  createHttpHostTransport,
  deriveWsEventsUrl,
  type CreateHttpCollectorServiceOptions,
  type HttpHostTransportOptions,
} from "./http-collector-client.js";

export type { CollectorHostTransport } from "./http-host-transport.js";

export type {
  ServiceIpcClient,
  ServiceIpcRequestOptions,
} from "@collector/service/ipc";
