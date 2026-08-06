/**
 * HTTP-backed CollectorService factory for the browser UI (#551 / #552 / #553).
 * Snapshot + full thumbnail resolve via host RPC (#552); media display via /media (#553).
 */

import type {
  CollectorService,
  DashboardSnapshotPort,
  UiSession,
  UiSessionThumbnailPaths,
} from "@collector/api";
import {
  createCollectorHostService,
  createHostDashboardSnapshotPort,
  createHostThumbnailsPort,
  createHttpHostTransport,
  type CollectorHostTransport,
} from "@collector/client";
import { seedQueryCacheFromSnapshot } from "./dashboard-snapshot-service";

function createHttpHostUiPorts(transport: CollectorHostTransport): {
  snapshot: DashboardSnapshotPort;
  thumbnails: UiSessionThumbnailPaths;
} {
  return {
    snapshot: createHostDashboardSnapshotPort(transport, {
      onSnapshotLoaded: seedQueryCacheFromSnapshot,
    }),
    thumbnails: createHostThumbnailsPort(transport),
  };
}

/** Domain ports over HTTP+WS host transport (#551). */
export function createHttpCollectorServiceFromTransport(
  transport: CollectorHostTransport,
  ports = createHttpHostUiPorts(transport),
): CollectorService {
  return createCollectorHostService(transport, ports);
}

/** UiSession for HTTP host cutover — host snapshot + thumb resolve (#552). */
export function createHttpUiSession(
  service: CollectorService,
  ports: {
    snapshot: DashboardSnapshotPort;
    thumbnails: UiSessionThumbnailPaths;
  },
): UiSession {
  return {
    snapshot: ports.snapshot,
    settingsSync: {
      getAppSettingsSync: () => service.settings.getAppSettingsSync(),
    },
    thumbnails: ports.thumbnails,
  };
}

export type HttpUiCutover = {
  service: CollectorService;
  session: UiSession;
  transport: CollectorHostTransport;
};

/** Dial host and build UI service + session (#551). */
export async function createHttpUiCutover(
  baseUrl: string,
  token: string,
): Promise<HttpUiCutover> {
  const transport = await createHttpHostTransport({ baseUrl, token });
  const ports = createHttpHostUiPorts(transport);
  const service = createHttpCollectorServiceFromTransport(transport, ports);
  const session = createHttpUiSession(service, ports);
  return { service, session, transport };
}
