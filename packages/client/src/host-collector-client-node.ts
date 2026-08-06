/**
 * Node dialer for Collector IPC client (#154/#240/#366 / #368 / #383).
 * Snapshot + thumbnail resolution use Node FS (not host wire FS on the client).
 *
 * Avoids importing `@collector/core` here — a top-level client→core edge can
 * resolve stale `core/dist` and break host media ops in the same process.
 */

import {
  connectHostWire,
  type HostWireClientOptions,
} from "@collector/service/host";
import type { HostWireClient } from "@collector/service/wire";
import {
  createCollectorHostDashboardSnapshotPort,
  createCollectorHostService,
  createCollectorHostServiceClient,
  type CollectorHostClientOptions,
  type CollectorHostServiceClient,
  type ServiceHostHealthResult,
} from "./host-collector-client.js";
import { createNodeSnapshotPort } from "./node-snapshot-port.js";
import { createNodeThumbnailPaths } from "./node-thumbnails.js";

export {
  createCollectorHostDashboardSnapshotPort,
  createCollectorHostService,
  createCollectorHostServiceClient,
  type CollectorHostClientOptions,
  type CollectorHostServiceClient,
  type ServiceHostHealthResult,
};

function createNodeUiSessionOptions(
  transport: HostWireClient,
): CollectorHostClientOptions {
  return {
    snapshot: createNodeSnapshotPort(transport),
    thumbnails: createNodeThumbnailPaths(transport),
  };
}

/** Dial the service host and return domain ports + transport extras (#369). */
export async function connectCollectorHostService(
  path: string,
  options?: HostWireClientOptions,
): Promise<CollectorHostServiceClient> {
  const transport = await connectHostWire(path, options);
  return createCollectorHostServiceClient(
    transport,
    createNodeUiSessionOptions(transport),
  );
}
