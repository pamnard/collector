/**
 * HTTP-backed CollectorService factory for the browser UI (#551).
 * Snapshot + thumbnail abs paths stay local until host cutover (#552).
 */

import type {
  ActiveVaultResult,
  CollectorService,
  UiSession,
} from "@collector/api";
import {
  createCollectorIpcService,
  createHttpHostTransport,
  type CollectorHostTransport,
} from "@collector/client";
import { createThumbnailResolveSession } from "./thumbnail-resolve-session";
import { createUiDashboardSnapshotPort } from "./ui-dashboard-snapshot-port";

function httpUiSessionOptions(transport: CollectorHostTransport) {
  const thumbnails = createThumbnailResolveSession({
    resolveActiveVault: () =>
      transport.request("ensureActiveVault") as Promise<ActiveVaultResult>,
  });
  return {
    snapshot: createUiDashboardSnapshotPort(),
    thumbnails,
  };
}

/** Domain ports over HTTP+WS host transport (#551). */
export function createHttpCollectorServiceFromTransport(
  transport: CollectorHostTransport,
): CollectorService {
  return createCollectorIpcService(transport, httpUiSessionOptions(transport));
}

/** UiSession for HTTP host cutover — local FS snapshot/thumbnails (#551 / #552). */
export function createHttpUiSession(
  transport: CollectorHostTransport,
  service: CollectorService,
): UiSession {
  return {
    snapshot: createUiDashboardSnapshotPort(),
    settingsSync: {
      getAppSettingsSync: () => service.settings.getAppSettingsSync(),
    },
    thumbnails: createThumbnailResolveSession({
      resolveActiveVault: () =>
        transport.request("ensureActiveVault") as Promise<ActiveVaultResult>,
    }),
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
  const service = createHttpCollectorServiceFromTransport(transport);
  const session = createHttpUiSession(transport, service);
  return { service, session, transport };
}
