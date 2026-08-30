import { selfContainedCollectorProfileLayout } from "@collector/shared";
import { join } from "node:path";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  SERVICE_HOST_EVENTS,
  createDomainWireRequestHandler,
  createHostHttpEventsHub,
  createServiceDomainRuntime,
  handleHttpRpc,
  isValidBearer,
  startServiceHost,
  writeJson,
  writeUnauthorized,
} from "@collector/service/host";
import {
  useTempDataDirs,
  waitForVaultIndexSyncDone,
  writeLegacyBrokenIndexDb,
} from "./host-collector-client-test-harness.js";
import { connectCollectorHostService } from "./host-collector-client-node.js";

describe("CollectorHostServiceClient vaults/boot/index (#160 / #162 / #922)", () => {
  const { mktemp } = useTempDataDirs();

  it("vaults list/switch/ensure work over HTTP (#160)", async () => {
    const dataDir = mktemp("collector-host-vaults-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        expect(await client.boot.getDataDirectory()).toBe(dataDir);

        const active = await client.boot.ensureActiveVault();
        expect(typeof active.vault.id).toBe("string");
        expect(active.vault.id.length).toBeGreaterThan(0);
        expect(typeof active.path).toBe("string");

        const listed = await client.vaults.listVaults();
        expect(listed.some((v) => v.id === active.vault.id)).toBe(true);

        const meta = await client.vaults.getActiveVaultMeta();
        expect(meta.id).toBe(active.vault.id);

        await client.vaults.setDefaultVault(active.vault.id);
        const switched = await client.vaults.switchVault(active.vault.id);
        expect(switched.id).toBe(active.vault.id);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("index boot open/ensureHealthy work over HTTP (#162)", async () => {
    const dataDir = mktemp("collector-host-boot-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        // Host already opened + healed on start; methods are idempotent.
        await client.boot.openCollectorDatabase();
        await client.boot.ensureCollectorDatabaseHealthy();
        expect(await client.health()).toMatchObject({
          ok: true,
          healthy: true,
          status: "healthy",
        });
        const active = await client.boot.ensureActiveVault();
        expect(typeof active.vault.id).toBe("string");
        expect(active.vault.id.length).toBeGreaterThan(0);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("ensureHealthy rebuilds an unhealthy index over HTTP (#162)", async () => {
    const dataDir = mktemp("collector-host-rebuild-");
    await writeLegacyBrokenIndexDb(join(dataDir, "collector.db"));

    // HTTP host without auto-heal so the client path exercises rebuild.
    const runtime = createServiceDomainRuntime(
      selfContainedCollectorProfileLayout(dataDir),
    );
    const token = "rebuild-test-host-token";
    const domainDispatch = createDomainWireRequestHandler(runtime);
    const eventsHub = createHostHttpEventsHub({ expectedToken: token });
    const stopSyncStatusBroadcast = runtime.vaultIndexSyncStatus.subscribe(
      (status) => {
        eventsHub.broadcastEvent(
          SERVICE_HOST_EVENTS.vaultIndexSyncStatus,
          status,
        );
      },
    );

    const server = createServer((req, res) => {
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

    try {
      const client = await connectCollectorHostService(baseUrl, { token });
      try {
        await client.boot.openCollectorDatabase();
        expect(await client.health()).toMatchObject({
          healthy: false,
          status: "unhealthy",
        });

        await client.boot.ensureCollectorDatabaseHealthy();
        expect(await client.health()).toMatchObject({
          ok: true,
          healthy: true,
          status: "healthy",
        });

        const active = await client.boot.ensureActiveVault();
        expect(typeof active.vault.id).toBe("string");
        expect(active.vault.id.length).toBeGreaterThan(0);
        await client.items.listDashboardItemIds("all");
        expect((await waitForVaultIndexSyncDone(client)).status).toBe("done");
        const page = await client.items.queryIndex("all", undefined, {
          limit: 10,
          offset: 0,
        });
        expect(Array.isArray(page.ids)).toBe(true);
      } finally {
        await client.close();
      }
    } finally {
      stopSyncStatusBroadcast();
      await eventsHub.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await runtime.close();
    }
  });
});
