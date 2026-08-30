/**
 * Collector service domain host (#151/#152/#155+/#237/#238/#551):
 * open index DB + HTTP ping/health/RPC/events with domain handlers.
 *
 * Uses the canonical profile layout (#238).
 *
 * Browser surfaces (#551/#553/#555/#882): always-on POST /api/rpc + WS /api/events +
 * GET/HEAD /media/file and /media/derive with the same host token.
 * Optional static UI dir + GET /api/ui-bootstrap for packaged browser UI (#555).
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import type { Subscription } from "@collector/api";
import type { CollectorProfileLayout } from "@collector/shared";
import {
  resolveCollectorProfileLayout,
  selfContainedCollectorProfileLayout,
} from "@collector/shared";
import { createDomainWireRequestHandler } from "./wire/domain-dispatch.js";
import { createServiceDomainRuntime } from "./domain-runtime.js";
import { SERVICE_HOST_EVENTS } from "./wire/framing.js";
import {
  defaultServiceHostTokenPath,
  generateServiceHostToken,
  removeServiceHostTokenFile,
  writeServiceHostTokenFile,
} from "./wire/auth.js";
import {
  defaultServiceHostBaseUrlPath,
  removeServiceHostBaseUrlFile,
  writeServiceHostBaseUrlFile,
} from "./wire/base-url.js";
import { vaultsRoot } from "@collector/core";
import { deriveWsEventsUrl } from "@collector/shared";
import { isValidBearer } from "./http/bearer.js";
import { writeCorsPreflight } from "./http/cors.js";
import { createHostHttpEventsHub } from "./http/events-hub.js";
import {
  handleMediaDerive,
  isMediaDeriveRequest,
} from "./http/media-derive.js";
import {
  handleMediaFile,
  isMediaFileRequest,
} from "./http/media-handler.js";
import { runServiceHostHttpRequest } from "./http/host-request.js";
import { handleHttpRpc, writeUnauthorized } from "./http/rpc-handler.js";
import { tryServeStaticUi } from "./http/static-ui.js";
import { writeJson } from "./http/write-json.js";

export const SERVICE_HOST_READY_PREFIX = "COLLECTOR_SERVICE_READY ";

/** Product default HTTP port for the local domain host (UI stays on :1420). */
export const DEFAULT_SERVICE_HOST_PORT = 1421;

/**
 * Resolve TCP listen port for the domain host.
 * Omitted → {@link DEFAULT_SERVICE_HOST_PORT}; explicit `0` → ephemeral OS port.
 */
export function resolveServiceHostListenPort(port?: number): number {
  return port ?? DEFAULT_SERVICE_HOST_PORT;
}

export interface ServiceHostOptions {
  /**
   * Vault files parent (`…/collector`). When `configDir` is omitted, uses the
   * self-contained layout (`{dataDir}/config` + `{dataDir}/collector.db`).
   */
  dataDir: string;
  /**
   * Settings directory (`…/collector` under appConfig in production).
   * Omit only for self-contained smoke profiles.
   */
  configDir?: string;
  /** Bind address (default 127.0.0.1). */
  host?: string;
  /**
   * TCP port. Default {@link DEFAULT_SERVICE_HOST_PORT} (1421).
   * Pass `0` for an ephemeral OS-assigned port (tests / smokes).
   */
  port?: number;
  /**
   * Directory of built browser UI (vite dist). When set, host serves static
   * files + SPA fallback and exposes GET /api/ui-bootstrap (#555).
   */
  uiDir?: string;
}

export interface ServiceHost {
  host: string;
  port: number;
  baseUrl: string;
  /** Browser WebSocket URL for push events (#551). */
  wsEventsUrl: string;
  /** Absolute UI static root when configured (#555). */
  uiDir: string | null;
  /** Resolved profile layout used by this host. */
  layout: CollectorProfileLayout;
  /** Open + healthy index session. */
  isHealthy: () => boolean;
  close: () => Promise<void>;
}

function resolveUiDir(uiDir: string | undefined): string | null {
  if (uiDir === undefined) {
    return null;
  }
  const trimmed = uiDir.trim();
  if (trimmed.length === 0) {
    throw new Error("service host uiDir must be a non-empty path when set (#555)");
  }
  const absolute = resolve(trimmed);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new Error(`service host uiDir is not a directory: ${absolute}`);
  }
  return absolute;
}

/** Loopback-only bind hosts may expose unauthenticated UI bootstrap (#555). */
function isLoopbackBindHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function resolveHostLayout(options: ServiceHostOptions): CollectorProfileLayout {
  if (options.configDir !== undefined) {
    return resolveCollectorProfileLayout({
      dataDir: options.dataDir,
      configDir: options.configDir,
    });
  }
  return selfContainedCollectorProfileLayout(options.dataDir);
}

export async function startServiceHost(
  options: ServiceHostOptions,
): Promise<ServiceHost> {
  const listenHost = options.host ?? "127.0.0.1";
  const listenPort = resolveServiceHostListenPort(options.port);
  const layout = resolveHostLayout(options);
  const uiDir = resolveUiDir(options.uiDir);

  const runtime = createServiceDomainRuntime(layout);
  await runtime.open();
  await runtime.ensureInitialized();
  // Ensure default vault + welcome item exist for host smokes/tests.
  await runtime.vaults.ensureActiveVault();
  await runtime.syncPluginWake.notifyVaultReady();

  const healthPayload = () => {
    const healthy = runtime.isHealthy();
    return {
      ok: healthy,
      status: healthy ? ("healthy" as const) : ("unhealthy" as const),
      open: true,
      healthy,
    };
  };

  const domainDispatch = createDomainWireRequestHandler(runtime);

  // Host token always minted for HTTP Bearer / WS auth (#551).
  const hostToken = generateServiceHostToken();
  const hostTokenPath = defaultServiceHostTokenPath(layout.dataDir);
  await writeServiceHostTokenFile(hostTokenPath, hostToken);

  const eventsHub = createHostHttpEventsHub({ expectedToken: hostToken });

  const vaultsRootPath = vaultsRoot(layout.dataDir);
  let vaultsRootResolved: string | undefined;
  try {
    vaultsRootResolved = realpathSync(vaultsRootPath);
  } catch {
    // Vaults dir may appear after first ensure; media handler falls back to realpath.
    vaultsRootResolved = undefined;
  }

  /** Filled after listen; request handlers close over this. */
  let boundPort = 0;

  const server: Server = createServer((req, res) => {
    runServiceHostHttpRequest(req, res, async () => {
      const url = new URL(req.url ?? "/", `http://${listenHost}`);

      if (req.method === "OPTIONS") {
        writeCorsPreflight(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/ping") {
        writeJson(req, res, 200, { ok: true, pong: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        if (!isValidBearer(req, hostToken)) {
          writeUnauthorized(req, res);
          return;
        }
        const body = healthPayload();
        writeJson(req, res, body.healthy ? 200 : 503, body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ui-bootstrap") {
        if (!isLoopbackBindHost(listenHost)) {
          writeJson(req, res, 403, { ok: false, error: "bootstrap_loopback_only" });
          return;
        }
        if (uiDir === null) {
          writeJson(req, res, 404, { ok: false, error: "ui_not_configured" });
          return;
        }
        if (boundPort === 0) {
          writeJson(req, res, 503, { ok: false, error: "not_listening" });
          return;
        }
        const baseUrl = `http://${listenHost}:${boundPort}`;
        const wsEventsUrl = deriveWsEventsUrl(baseUrl);
        writeJson(req, res, 200, {
          baseUrl,
          token: hostToken,
          wsEventsUrl,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rpc") {
        if (!isValidBearer(req, hostToken)) {
          writeUnauthorized(req, res);
          return;
        }
        await handleHttpRpc(req, res, domainDispatch);
        return;
      }

      if (isMediaFileRequest(req.method, url.pathname)) {
        await handleMediaFile(req, res, url, {
          expectedToken: hostToken,
          vaultsRootPath,
          ...(vaultsRootResolved === undefined
            ? {}
            : { vaultsRootResolved }),
        });
        return;
      }

      if (isMediaDeriveRequest(req.method, url.pathname)) {
        await handleMediaDerive(req, res, url, {
          expectedToken: hostToken,
          vaultsRootPath,
          dataDir: layout.dataDir,
          ...(vaultsRootResolved === undefined
            ? {}
            : { vaultsRootResolved }),
        });
        return;
      }

      if (uiDir !== null && tryServeStaticUi(req, res, uiDir, url.pathname)) {
        return;
      }

      writeJson(req, res, 404, { ok: false, error: "not_found" });
    });
  });

  eventsHub.attach(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("service host failed to bind a TCP port");
  }
  boundPort = address.port;

  const baseUrl = `http://${listenHost}:${address.port}`;
  const wsEventsUrl = deriveWsEventsUrl(baseUrl);
  const hostBaseUrlPath = defaultServiceHostBaseUrlPath(layout.dataDir);
  await writeServiceHostBaseUrlFile(hostBaseUrlPath, baseUrl);

  let stopSyncStatusBroadcast: Subscription | null = null;
  let stopDerivedCatchUpBroadcast: Subscription | null = null;
  let stopAppSettingsBroadcast: Subscription | null = null;
  let stopPresentationChangedBroadcast: Subscription | null = null;
  let stopJobPermanentFailureBroadcast: Subscription | null = null;

  const broadcastEvent = (event: string, payload: unknown): void => {
    eventsHub.broadcastEvent(event, payload);
  };

  stopSyncStatusBroadcast = runtime.vaultIndexSyncStatus.subscribe((status) => {
    broadcastEvent(SERVICE_HOST_EVENTS.vaultIndexSyncStatus, status);
  });
  stopDerivedCatchUpBroadcast = runtime.derivedCatchUpStatus.subscribe(
    (status) => {
      broadcastEvent(SERVICE_HOST_EVENTS.derivedCatchUpStatus, status);
    },
  );
  stopAppSettingsBroadcast = runtime.appSettings.subscribeAppSettings(
    (settings) => {
      broadcastEvent(SERVICE_HOST_EVENTS.appSettings, settings);
    },
  );
  stopPresentationChangedBroadcast = runtime.vaultPresentationChanged.subscribe(
    (payload) => {
      broadcastEvent(SERVICE_HOST_EVENTS.vaultPresentationChanged, payload);
    },
  );
  stopJobPermanentFailureBroadcast = runtime.jobPermanentFailure.subscribe(
    (payload) => {
      broadcastEvent(SERVICE_HOST_EVENTS.jobPermanentFailure, payload);
    },
  );

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    stopSyncStatusBroadcast?.unsubscribe();
    stopSyncStatusBroadcast = null;
    stopDerivedCatchUpBroadcast?.unsubscribe();
    stopDerivedCatchUpBroadcast = null;
    stopAppSettingsBroadcast?.unsubscribe();
    stopAppSettingsBroadcast = null;
    stopPresentationChangedBroadcast?.unsubscribe();
    stopPresentationChangedBroadcast = null;
    stopJobPermanentFailureBroadcast?.unsubscribe();
    stopJobPermanentFailureBroadcast = null;
    await eventsHub.close();
    await removeServiceHostTokenFile(hostTokenPath);
    await removeServiceHostBaseUrlFile(hostBaseUrlPath);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await runtime.close();
  };

  return {
    host: listenHost,
    port: address.port,
    baseUrl,
    wsEventsUrl,
    uiDir,
    layout,
    isHealthy: () => runtime.isHealthy(),
    close,
  };
}

/** Print one READY line for smoke/scripts that spawn the host as a child process. */
export function formatServiceHostReadyLine(host: ServiceHost): string {
  return `${SERVICE_HOST_READY_PREFIX}${JSON.stringify({
    host: host.host,
    port: host.port,
    baseUrl: host.baseUrl,
    wsEventsUrl: host.wsEventsUrl,
    uiDir: host.uiDir,
    dataDir: host.layout.dataDir,
    configDir: host.layout.configDir,
    indexDbPath: host.layout.indexDbPath,
    jobsDbPath: host.layout.jobsDbPath,
  })}`;
}
