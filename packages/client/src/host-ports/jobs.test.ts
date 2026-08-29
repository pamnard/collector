/**
 * createHostJobsPort against a real service host (#630).
 * getJobStats over HTTP RPC; permanent-failure subscribe over WS push
 * after a real `__test_noop` permanent fail.
 */

import { JOBS_PORT_KEYS, type JobPermanentFailure, type JobStats } from "@collector/api";
import { selfContainedCollectorProfileLayout } from "@collector/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_ORCHESTRATED_PORT_METHODS,
  createDomainWireRequestHandler,
  createHostHttpEventsHub,
  createServiceDomainRuntime,
  defaultServiceHostTokenPath,
  generateServiceHostToken,
  handleHttpRpc,
  isValidBearer,
  SERVICE_HOST_EVENTS,
  startServiceHost,
  writeJson,
  writeServiceHostTokenFile,
  writeUnauthorized,
  type ServiceDomainRuntime,
} from "@collector/service/host";
import { connectCollectorHostService } from "../host-collector-client-node.js";
import { createHttpHostTransport } from "../http-host-transport.js";
import { createHostSessionCtx } from "../host-session-ctx.js";
import { createHostJobsPort } from "./jobs.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDataDir(prefix: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dataDir);
  return dataDir;
}

/**
 * Product host stack with a retained runtime so tests can enqueue `__test_noop`.
 * Mirrors startServiceHost wire + jobPermanentFailure broadcast (#630).
 */
async function startJobsHostWithRuntime(dataDir: string): Promise<{
  runtime: ServiceDomainRuntime;
  baseUrl: string;
  token: string;
  close: () => Promise<void>;
}> {
  const layout = selfContainedCollectorProfileLayout(dataDir);
  const runtime = createServiceDomainRuntime(layout);
  await runtime.open();
  await runtime.ensureInitialized();
  await runtime.vaults.ensureActiveVault();

  const token = generateServiceHostToken();
  await writeServiceHostTokenFile(defaultServiceHostTokenPath(dataDir), token);

  const eventsHub = createHostHttpEventsHub({ expectedToken: token });
  const domainDispatch = createDomainWireRequestHandler(runtime);
  const stopJobPermanentFailureBroadcast = runtime.jobPermanentFailure.subscribe(
    (payload) => {
      eventsHub.broadcastEvent(SERVICE_HOST_EVENTS.jobPermanentFailure, payload);
    },
  );

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/ping") {
        writeJson(req, res, 200, { ok: true, pong: true });
        return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        if (!isValidBearer(req, token)) {
          writeUnauthorized(req, res);
          return;
        }
        const healthy = runtime.isHealthy();
        writeJson(req, res, healthy ? 200 : 503, {
          ok: healthy,
          status: healthy ? "healthy" : "unhealthy",
          open: true,
          healthy,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/rpc") {
        if (!isValidBearer(req, token)) {
          writeUnauthorized(req, res);
          return;
        }
        await handleHttpRpc(req, res, domainDispatch);
        return;
      }
      writeJson(req, res, 404, { ok: false, error: "not_found" });
    })();
  });
  eventsHub.attach(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    runtime,
    baseUrl,
    token,
    close: async () => {
      stopJobPermanentFailureBroadcast.unsubscribe();
      await eventsHub.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await runtime.close();
    },
  };
}

function assertJobStatsShape(stats: JobStats): void {
  expect(stats).toEqual({
    pending: expect.any(Number),
    running: expect.any(Number),
    succeeded: expect.any(Number),
    failed: expect.any(Number),
    cancelled: expect.any(Number),
    byType: expect.any(Object),
  });
  expect(stats.pending).toBeGreaterThanOrEqual(0);
  expect(stats.running).toBeGreaterThanOrEqual(0);
  expect(stats.succeeded).toBeGreaterThanOrEqual(0);
  expect(stats.failed).toBeGreaterThanOrEqual(0);
  expect(stats.cancelled).toBeGreaterThanOrEqual(0);
}

describe("createHostJobsPort (#630)", () => {
  it("JOBS_PORT_KEYS is the contract for the jobs port surface", () => {
    expect(JOBS_PORT_KEYS).toEqual([
      "getJobStats",
      "subscribeJobPermanentFailure",
    ]);
    expect(CLIENT_ORCHESTRATED_PORT_METHODS).toContain(
      "subscribeJobPermanentFailure",
    );
    expect(SERVICE_HOST_EVENTS.jobPermanentFailure).toBe("jobPermanentFailure");
  });

  it("getJobStats returns live queue stats over startServiceHost wire", async () => {
    const dataDir = tempDataDir("collector-jobs-port-stats-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, {
        dataDir,
      });
      try {
        const port = client.jobs;
        expect(typeof port.getJobStats).toBe("function");
        expect(typeof port.subscribeJobPermanentFailure).toBe("function");

        const stats = await port.getJobStats();
        assertJobStatsShape(stats);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  // Live host boots itemDerivedRefresh / refreshEmbeddings on the same jobs DB.
  // getJobStats RPC can take hundreds of ms under that contention; default
  // waitFor (1s) only gets one slow poll and flakes (#912).
  const liveHostWaitMs = 10_000;

  it(
    "subscribeJobPermanentFailure receives host push after real noop permanent fail",
    { timeout: 20_000 },
    async () => {
      const dataDir = tempDataDir("collector-jobs-port-pf-");
      const { runtime, baseUrl, token, close } =
        await startJobsHostWithRuntime(dataDir);
      const transport = await createHttpHostTransport({
        baseUrl,
        token,
        enableEvents: true,
        connectTimeoutMs: 2_000,
      });
      try {
        const port = createHostJobsPort(createHostSessionCtx(transport));
        const seen: JobPermanentFailure[] = [];
        const sub = port.subscribeJobPermanentFailure((failure) => {
          seen.push(failure);
        });

        const before = await port.getJobStats();
        assertJobStatsShape(before);

        const { id } = await runtime.jobs.enqueue({
          type: "__test_noop",
          payload: { fail: "permanent" },
        });

        await vi.waitFor(
          () => {
            expect(seen).toEqual([
              expect.objectContaining({
                id,
                type: "__test_noop",
                error: "noop permanent fail",
                attempts: expect.any(Number),
              }),
            ]);
          },
          { timeout: liveHostWaitMs },
        );

        await vi.waitFor(
          async () => {
            const after = await port.getJobStats();
            expect(after.failed).toBeGreaterThanOrEqual(before.failed + 1);
            expect(after.byType.__test_noop?.failed).toBeGreaterThanOrEqual(1);
          },
          { timeout: liveHostWaitMs },
        );

        sub.unsubscribe();
        seen.length = 0;
        await runtime.jobs.enqueue({
          type: "__test_noop",
          payload: { fail: "permanent" },
        });
        await vi.waitFor(
          async () => {
            const stats = await port.getJobStats();
            expect(stats.byType.__test_noop?.failed).toBeGreaterThanOrEqual(2);
          },
          { timeout: liveHostWaitMs },
        );
        expect(seen).toEqual([]);
      } finally {
        await transport.close();
        await close();
      }
    },
  );
});
