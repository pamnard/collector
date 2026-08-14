/**
 * Node dialer for Collector host over HTTP (#551 / #154 / #366).
 * Snapshot + thumbnail resolution use Node FS.
 *
 * Avoids importing `@collector/core` here — a top-level client→core edge can
 * resolve stale `core/dist` and break host media ops in the same process.
 */

import {
  resolveServiceHostToken,
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
import {
  createHttpHostTransport,
  type HttpHostTransportOptions,
} from "./http-host-transport.js";
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

export type ConnectCollectorHostServiceOptions = CollectorHostClientOptions &
  Pick<HttpHostTransportOptions, "enableEvents" | "connectTimeoutMs" | "requestTimeoutMs"> & {
    dataDir?: string;
    token?: string;
    tokenFile?: string;
  };

function createNodeUiSessionOptions(
  transport: HostWireClient,
): CollectorHostClientOptions {
  return {
    snapshot: createNodeSnapshotPort(transport),
    thumbnails: createNodeThumbnailPaths(transport),
  };
}

/** Dial the service host over HTTP and return domain ports + transport extras. */
export async function connectCollectorHostService(
  baseUrl: string,
  options: ConnectCollectorHostServiceOptions = {},
): Promise<CollectorHostServiceClient> {
  const {
    dataDir,
    token: explicitToken,
    tokenFile,
    enableEvents,
    connectTimeoutMs,
    requestTimeoutMs,
    snapshot,
    thumbnails,
  } = options;

  const token = await resolveServiceHostToken({
    ...(explicitToken === undefined ? {} : { token: explicitToken }),
    ...(tokenFile === undefined ? {} : { tokenFile }),
    ...(dataDir === undefined ? {} : { dataDir }),
  });

  const transport = await createHttpHostTransport({
    baseUrl,
    token,
    ...(enableEvents === undefined ? {} : { enableEvents }),
    ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  });

  return createCollectorHostServiceClient(transport, {
    ...createNodeUiSessionOptions(transport),
    ...(snapshot === undefined ? {} : { snapshot }),
    ...(thumbnails === undefined ? {} : { thumbnails }),
  });
}
