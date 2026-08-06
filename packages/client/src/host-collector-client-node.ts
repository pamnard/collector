/**
 * Node dialer for Collector IPC client (#154/#240/#366 / #368 / #383).
 * Snapshot + thumbnail resolution use Node FS (not host IPC).
 *
 * Avoids importing `@collector/core` here — a top-level client→core edge can
 * resolve stale `core/dist` and break host media ops in the same process.
 */

import {
  connectServiceIpc,
  type ServiceIpcClientOptions,
} from "@collector/service/host";
import type { ServiceIpcClient } from "@collector/service/ipc";
import {
  createCollectorIpcDashboardSnapshotPort,
  createCollectorIpcService,
  createCollectorIpcServiceClient,
  type CollectorIpcClientOptions,
  type CollectorIpcServiceClient,
  type ServiceIpcHealthResult,
} from "./ipc-collector-client.js";
import { createNodeSnapshotPort } from "./node-snapshot-port.js";
import { createNodeThumbnailPaths } from "./node-thumbnails.js";

export {
  createCollectorIpcDashboardSnapshotPort,
  createCollectorIpcService,
  createCollectorIpcServiceClient,
  type CollectorIpcClientOptions,
  type CollectorIpcServiceClient,
  type ServiceIpcHealthResult,
};

function createNodeUiSessionOptions(
  transport: ServiceIpcClient,
): CollectorIpcClientOptions {
  return {
    snapshot: createNodeSnapshotPort(transport),
    thumbnails: createNodeThumbnailPaths(transport),
  };
}

/** Dial the service host and return domain ports + transport extras (#369). */
export async function connectCollectorIpcService(
  path: string,
  options?: ServiceIpcClientOptions,
): Promise<CollectorIpcServiceClient> {
  const transport = await connectServiceIpc(path, options);
  return createCollectorIpcServiceClient(
    transport,
    createNodeUiSessionOptions(transport),
  );
}
