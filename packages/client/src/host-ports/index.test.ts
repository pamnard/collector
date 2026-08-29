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

async function dialIndexTransport(baseUrl: string, token: string) {
  return createHttpHostTransport({
    baseUrl,
    token,
    enableEvents: true,
    connectTimeoutMs: 2_000,
  });
}

/**
 * Retained runtime so tests can drive derivedCatchUpStatus store updates
 * over the same WS event as production (#767), mirroring jobs.test host stack.
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
      const transport = await dialIndexTransport(
        host.baseUrl,
        await resolveServiceHostToken({ dataDir }),
      );
      try {
        await createCollectorHostService(transport).boot.ensureActiveVault();
        const port = createHostIndexPort(createHostSessionCtx(transport));
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
        // Best-effort seed swallows RPC errors — assert the method name explicitly.
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
    const transport = await dialIndexTransport(baseUrl, token);
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

      const idle: DerivedCatchUpStatus = {
        vaultId: null,
        status: "idle",
        pending: 0,
        running: 0,
      };
      const witness: DerivedCatchUpStatus[] = [];
      const witnessSub = createHostIndexPort(
        createHostSessionCtx(transport),
      ).subscribeDerivedCatchUpStatus((status) => {
        witness.push(status);
      });
      runtime.derivedCatchUpStatus.set(idle);
      await vi.waitFor(() => {
        expect(witness).toContainEqual(idle);
      });
      expect(seen).toHaveLength(beforeUnsub);
      witnessSub.unsubscribe();
    } finally {
      await transport.close();
      await close();
    }
  });

  it("subscribeVaultIndexSyncStatus receives live sync progression over WS", async () => {
    const dataDir = tempDataDir("collector-index-sync-sub-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await dialIndexTransport(
        host.baseUrl,
        await resolveServiceHostToken({ dataDir }),
      );
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
        expect(await transport.request("getVaultIndexSyncStatus")).toEqual(
          port.getVaultIndexSyncStatus(),
        );
        sub.unsubscribe();
      } finally {
        await transport.close();
      }
    } finally {
      await host.close();
    }
  });
});
