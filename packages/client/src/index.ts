/**
 * @collector/client — browser-safe CollectorService factories (#154/#240/#366/#370/#551).
 * Injectable transport only — no Node dialer in this entry.
 */

export {
  createCollectorHostDashboardSnapshotPort,
  createCollectorHostService,
  createCollectorHostServiceClient,
  type CollectorHostClientOptions,
  type CollectorHostServiceClient,
  type CollectorHostTransportExtras,
  type ServiceHostHealthResult,
} from "./host-collector-client.js";

export {
  createHttpCollectorService,
  createHttpHostTransport,
  deriveWsEventsUrl,
  type CreateHttpCollectorServiceOptions,
  type HttpHostTransportOptions,
} from "./http-collector-client.js";

export type { CollectorHostTransport } from "./http-host-transport.js";

export {
  createHostDashboardSnapshotPort,
  type HostDashboardSnapshotPortOptions,
} from "./host-ports/dashboard-snapshot.js";
export { createHostThumbnailsPort } from "./host-ports/thumbnails.js";

export type {
  HostWireClient,
  HostWireRequestOptions,
} from "@collector/service/wire";
