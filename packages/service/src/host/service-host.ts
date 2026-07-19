/**
 * Out-of-band Collector service host (#151): open index DB + HTTP health/ping.
 * Must not be started by the Tauri app lifecycle (dual-writer risk).
 */

import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { createCollectorIndexBoot } from "../index-boot.js";
import { NodeSqliteExecutor } from "./node-sql.js";

export const SERVICE_HOST_READY_PREFIX = "COLLECTOR_SERVICE_READY ";

export interface ServiceHostOptions {
  /** Isolated data directory; index DB is `<dataDir>/collector.db`. */
  dataDir: string;
  /** Bind address (default 127.0.0.1). */
  host?: string;
  /** TCP port; 0 = ephemeral (default). */
  port?: number;
}

export interface ServiceHost {
  host: string;
  port: number;
  baseUrl: string;
  /** Open + healthy index session. */
  isHealthy: () => boolean;
  close: () => Promise<void>;
}

function json(
  res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void },
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
  const dbPath = join(options.dataDir, "collector.db");

  const boot = createCollectorIndexBoot({
    prepareEnvironment: async () => {
      await mkdir(options.dataDir, { recursive: true });
    },
    openSql: async () => NodeSqliteExecutor.open(dbPath),
  });

  await boot.open();
  await boot.ensureHealthy();

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${listenHost}`);
    if (req.method === "GET" && url.pathname === "/ping") {
      json(res, 200, { ok: true, pong: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      const healthy = boot.isHealthy();
      json(res, healthy ? 200 : 503, {
        ok: healthy,
        status: healthy ? "healthy" : "unhealthy",
        open: boot.isOpen(),
        healthy,
      });
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

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    const sql = boot.getSql();
    if (sql) {
      await sql.close();
    }
  };

  return {
    host: listenHost,
    port: address.port,
    baseUrl: `http://${listenHost}:${address.port}`,
    isHealthy: () => boot.isHealthy(),
    close,
  };
}

/** Print one READY line for smoke/scripts that spawn the host as a child process. */
export function formatServiceHostReadyLine(host: ServiceHost): string {
  return `${SERVICE_HOST_READY_PREFIX}${JSON.stringify({
    host: host.host,
    port: host.port,
    baseUrl: host.baseUrl,
  })}`;
}
