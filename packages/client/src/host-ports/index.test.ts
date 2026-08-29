/**
 * createHostIndexPort against a real service host (#767 / #888).
 * Seed RPC + WS push for derived catch-up and vault index sync.
 */

import {
  INDEX_PORT_KEYS,
  type DerivedCatchUpStatus,
  type IndexPort,
  type VaultIndexSyncStatus,
} from "@collector/api";
import { selfContainedCollectorProfileLayout } from "@collector/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDomainWireRequestHandler,
  createHostHttpEventsHub,
  createServiceDomainRuntime,
  defaultServiceHostTokenPath,
  generateServiceHostToken,
  handleHttpRpc,
  isValidBearer,
  resolveServiceHostToken,
  SERVICE_HOST_EVENTS,
  startServiceHost,
  writeJson,
  writeServiceHostTokenFile,
  writeUnauthorized,
  type ServiceDomainRuntime,
} from "@collector/service/host";
import { createCollectorHostService } from "../host-collector-client.js";
import { createHttpHostTransport } from "../http-host-transport.js";
import { createHostSessionCtx } from "../host-session-ctx.js";
import { createHostIndexPort } from "./index.js";

const dirs: string[] = [];

afterEach(() => {
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
 * Host stack with a retained runtime so tests can drive derivedCatchUpStatus
 * store updates that broadcast over the same WS event as production (#767).
 */
async function startIndexHostWithRuntime(dataDir: string): Promise<{
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
  const stopDerivedCatchUpBroadcast = runtime.derivedCatchUpStatus.subscribe(
    (status) => {
      eventsHub.broadcastEvent(SERVICE_HOST_EVENTS.derivedCatchUpStatus, status);
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
      stopDerivedCatchUpBroadcast.unsubscribe();
      await eventsHub.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await runtime.close();
    },
  };
}

describe("createHostIndexPort (#767 / #888)", () => {
  it("INDEX_PORT_KEYS is the contract for the index port surface", () => {
    expect([...INDEX_PORT_KEYS].sort()).toEqual(
      [
        "getDerivedCatchUpStatus",
        "getVaultIndexSyncStatus",
        "subscribeDerivedCatchUpStatus",
        "subscribeVaultIndexSyncStatus",
        "subscribeVaultPresentationChanged",
      ].sort(),
    );
  });

  it("getDerivedCatchUpStatus reflects host seed RPC over startServiceHost wire", async () => {
    const dataDir = tempDataDir("collector-index-catchup-get-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: await resolveServiceHostToken({ dataDir }),
        enableEvents: true,
        connectTimeoutMs: 2_000,
      });
      try {
        await createCollectorHostService(transport).boot.ensureActiveVault();
        const ctx = createHostSessionCtx(transport);
        const port = createHostIndexPort(ctx);
        for (const key of INDEX_PORT_KEYS) {
          expect(typeof port[key as keyof IndexPort], key).toBe("function");
        }

        const seen: DerivedCatchUpStatus[] = [];
        const sub = port.subscribeDerivedCatchUpStatus((status) => {
          seen.push(status);
        });
        await vi.waitFor(() => {
          expect(seen.length).toBeGreaterThanOrEqual(1);
          expect(seen.some((s) => s.status === "idle")).toBe(true);
        });
        expect(port.getDerivedCatchUpStatus()).toMatchObject({
          status: "idle",
          pending: 0,
          running: 0,
        });
        // Seed used getDerivedCatchUpStatus over RPC (not a hand-rolled cache).
        expect(await transport.request("getDerivedCatchUpStatus")).toEqual(
          port.getDerivedCatchUpStatus(),
        );
        sub.unsubscribe();
      } finally {
        await transport.close();
      }
    } finally {
      await host.close();
    }
  });

  it("subscribeDerivedCatchUpStatus receives host WS push and tears down on unsubscribe", async () => {
    const dataDir = tempDataDir("collector-index-catchup-sub-");
    const { runtime, baseUrl, token, close } =
      await startIndexHostWithRuntime(dataDir);
    const transport = await createHttpHostTransport({
      baseUrl,
      token,
      enableEvents: true,
      connectTimeoutMs: 2_000,
    });
    try {
      const port = createHostIndexPort(createHostSessionCtx(transport));
      const seen: DerivedCatchUpStatus[] = [];
      const sub = port.subscribeDerivedCatchUpStatus((status) => {
        seen.push(status);
      });

      await vi.waitFor(() => {
        expect(seen.some((s) => s.status === "idle")).toBe(true);
      });

      const running: DerivedCatchUpStatus = {
        vaultId: "vault-wire",
        status: "running",
        pending: 2,
        running: 1,
      };
      runtime.derivedCatchUpStatus.set(running);

      await vi.waitFor(() => {
        expect(seen).toContainEqual(running);
      });
      expect(port.getDerivedCatchUpStatus()).toEqual(running);
      expect(await transport.request("getDerivedCatchUpStatus")).toEqual(
        running,
      );

      const beforeUnsub = seen.length;
      sub.unsubscribe();
      runtime.derivedCatchUpStatus.set({
        vaultId: null,
        status: "idle",
        pending: 0,
        running: 0,
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(seen).toHaveLength(beforeUnsub);
    } finally {
      await transport.close();
      await close();
    }
  });

  it("subscribeVaultIndexSyncStatus receives live sync progression over WS", async () => {
    const dataDir = tempDataDir("collector-index-sync-sub-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: await resolveServiceHostToken({ dataDir }),
        enableEvents: true,
        connectTimeoutMs: 2_000,
      });
      try {
        const service = createCollectorHostService(transport);
        await service.boot.ensureActiveVault();
        const port = createHostIndexPort(createHostSessionCtx(transport));

        const seen: VaultIndexSyncStatus[] = [];
        const sub = port.subscribeVaultIndexSyncStatus((status) => {
          seen.push(status);
        });

        await service.items.listDashboardItemIds("all");

        await vi.waitFor(
          () => {
            expect(
              seen.some((s) => s.status === "done" || s.status === "running"),
            ).toBe(true);
          },
          { timeout: 15_000 },
        );
        expect(port.getVaultIndexSyncStatus().vaultId).toBeTruthy();
        sub.unsubscribe();

        const before = seen.length;
        await service.items.listDashboardItemIds("all");
        await new Promise((r) => setTimeout(r, 200));
        expect(seen).toHaveLength(before);
      } finally {
        await transport.close();
      }
    } finally {
      await host.close();
    }
  });
});
