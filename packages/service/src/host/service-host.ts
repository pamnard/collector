/**
 * Collector service domain host (#151/#152/#155+/#237/#238/#551):
 * open index DB + HTTP ping/health/RPC/events + local dial with domain handlers.
 *
 * Uses the canonical profile layout (#238). Default desktop path stays
 * in-process until cutover (#170). Supervise may start this host behind
 * COLLECTOR_ENABLE_SERVICE_SUPERVISE with an isolated `--data-dir`
 * (self-contained layout) so it does not share SQLite with the UI writer.
 *
 * Browser surfaces (#551/#553): always-on POST /api/rpc + WS /api/events +
 * GET/HEAD /media/file with the same host token as the local dial.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Subscription } from "@collector/api";
import type { CollectorProfileLayout } from "@collector/shared";
import {
  resolveCollectorProfileLayout,
  selfContainedCollectorProfileLayout,
} from "@collector/shared";
import { createDomainWireRequestHandler } from "./wire/domain-dispatch.js";
import { startHostWireServer, type HostWireServer } from "./wire/server.js";
import { createServiceDomainRuntime } from "./domain-runtime.js";
import { SERVICE_HOST_EVENTS } from "./wire/framing.js";
import {
  defaultServiceHostTokenPath,
  generateServiceHostToken,
  removeServiceHostTokenFile,
  writeServiceHostTokenFile,
} from "./wire/auth.js";
import { vaultsRoot } from "@collector/core";
import { isValidBearer } from "./http/bearer.js";
import { corsHeadersForRequest, writeCorsPreflight } from "./http/cors.js";
import { createHostHttpEventsHub } from "./http/events-hub.js";
import {
  handleMediaFile,
  isMediaFileRequest,
} from "./http/media-handler.js";
import { handleHttpRpc, writeUnauthorized } from "./http/rpc-handler.js";

export const SERVICE_HOST_READY_PREFIX = "COLLECTOR_SERVICE_READY ";

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
  /** TCP port; 0 = ephemeral (default). */
  port?: number;
  /**
   * Local IPC path. Default: platform path under `dataDir`.
   * Pass `false` to disable IPC (HTTP-only).
   */
  ipcPath?: string | false;
}

export interface ServiceHost {
  host: string;
  port: number;
  baseUrl: string;
  /** Browser WebSocket URL for push events (#551). */
  wsEventsUrl: string;
  /** Local IPC endpoint (Unix socket or Windows named pipe), if enabled. */
  ipcPath: string | null;
  /** Resolved profile layout used by this host. */
  layout: CollectorProfileLayout;
  /** Open + healthy index session. */
  isHealthy: () => boolean;
  close: () => Promise<void>;
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

function json(
  req: IncomingMessage,
  res: ServerResponse,
  code: number,
  body: unknown,
): void {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    ...corsHeadersForRequest(req),
  });
  res.end(payload);
}

export async function startServiceHost(
  options: ServiceHostOptions,
): Promise<ServiceHost> {
  const listenHost = options.host ?? "127.0.0.1";
  const listenPort = options.port ?? 0;
  const layout = resolveHostLayout(options);

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

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${listenHost}`);

      if (req.method === "OPTIONS") {
        writeCorsPreflight(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/ping") {
        json(req, res, 200, { ok: true, pong: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        if (!isValidBearer(req, hostToken)) {
          writeUnauthorized(req, res);
          return;
        }
        const body = healthPayload();
        json(req, res, body.healthy ? 200 : 503, body);
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
          vaultsRootPath: vaultsRoot(layout.dataDir),
        });
        return;
      }

      json(req, res, 404, { ok: false, error: "not_found" });
    })();
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

  const baseUrl = `http://${listenHost}:${address.port}`;
  const wsEventsUrl = `ws://${listenHost}:${address.port}/api/events`;

  let ipc: HostWireServer | null = null;
  let stopSyncStatusBroadcast: Subscription | null = null;
  let stopAppSettingsBroadcast: Subscription | null = null;

  const broadcastBoth = (event: string, payload: unknown): void => {
    ipc?.broadcastEvent(event, payload);
    eventsHub.broadcastEvent(event, payload);
  };

  if (options.ipcPath !== false) {
    ipc = await startHostWireServer({
      dataDir: layout.dataDir,
      path: typeof options.ipcPath === "string" ? options.ipcPath : undefined,
      token: hostToken,
      handler: {
        ping: () => ({ ok: true, pong: true }),
        health: healthPayload,
        request: domainDispatch,
      },
    });
  }

  stopSyncStatusBroadcast = runtime.vaultIndexSyncStatus.subscribe((status) => {
    broadcastBoth(SERVICE_HOST_EVENTS.vaultIndexSyncStatus, status);
  });
  stopAppSettingsBroadcast = runtime.appSettings.subscribeAppSettings(
    (settings) => {
      broadcastBoth(SERVICE_HOST_EVENTS.appSettings, settings);
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
    stopAppSettingsBroadcast?.unsubscribe();
    stopAppSettingsBroadcast = null;
    await eventsHub.close();
    if (ipc) {
      await ipc.close();
      ipc = null;
    }
    await removeServiceHostTokenFile(hostTokenPath);
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
    ipcPath: ipc?.path ?? null,
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
    ipcPath: host.ipcPath,
    dataDir: host.layout.dataDir,
    configDir: host.layout.configDir,
    indexDbPath: host.layout.indexDbPath,
  })}`;
}
