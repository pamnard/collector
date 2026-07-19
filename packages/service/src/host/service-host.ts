/**
 * Out-of-band Collector service host (#151/#152/#155+):
 * open index DB + HTTP health/ping + local IPC with domain handlers.
 * Must not be started by the Tauri app lifecycle (dual-writer risk).
 */

import { createServer, type Server } from "node:http";
import {
  createDomainIpcDispatcher,
  buildDomainIpcHandlers,
} from "./ipc/domain-handlers.js";
import { startServiceIpcServer, type ServiceIpcServer } from "./ipc/server.js";
import { createServiceDomainRuntime } from "./domain-runtime.js";

export const SERVICE_HOST_READY_PREFIX = "COLLECTOR_SERVICE_READY ";

export interface ServiceHostOptions {
  /** Isolated data directory; index DB is `<dataDir>/collector.db`. */
  dataDir: string;
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
  /** Local IPC endpoint (Unix socket or Windows named pipe), if enabled. */
  ipcPath: string | null;
  /** Open + healthy index session. */
  isHealthy: () => boolean;
  close: () => Promise<void>;
}

function json(
  res: {
    writeHead: (code: number, headers: Record<string, string>) => void;
    end: (body: string) => void;
  },
  code: number,
  body: unknown,
): void {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
  });
  res.end(payload);
}

export async function startServiceHost(
  options: ServiceHostOptions,
): Promise<ServiceHost> {
  const listenHost = options.host ?? "127.0.0.1";
  const listenPort = options.port ?? 0;

  const runtime = createServiceDomainRuntime(options.dataDir);
  await runtime.open();
  await runtime.ensureInitialized();
  // Ensure default vault + welcome item exist for host smokes/tests.
  await runtime.vaults.ensureActiveVault();

  const healthPayload = () => {
    const healthy = runtime.isHealthy();
    return {
      ok: healthy,
      status: healthy ? ("healthy" as const) : ("unhealthy" as const),
      open: true,
      healthy,
    };
  };

  const domainDispatch = createDomainIpcDispatcher(
    buildDomainIpcHandlers(runtime),
  );

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${listenHost}`);
    if (req.method === "GET" && url.pathname === "/ping") {
      json(res, 200, { ok: true, pong: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      const body = healthPayload();
      json(res, body.healthy ? 200 : 503, body);
      return;
    }
    json(res, 404, { ok: false, error: "not_found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("service host failed to bind a TCP port");
  }

  let ipc: ServiceIpcServer | null = null;
  if (options.ipcPath !== false) {
    ipc = await startServiceIpcServer({
      dataDir: options.dataDir,
      path: typeof options.ipcPath === "string" ? options.ipcPath : undefined,
      handler: {
        ping: () => ({ ok: true, pong: true }),
        health: healthPayload,
        request: domainDispatch,
      },
    });
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    if (ipc) {
      await ipc.close();
      ipc = null;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await runtime.close();
  };

  return {
    host: listenHost,
    port: address.port,
    baseUrl: `http://${listenHost}:${address.port}`,
    ipcPath: ipc?.path ?? null,
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
    ipcPath: host.ipcPath,
  })}`;
}
