/**
 * Live facade smoke across domain ports (#366 / #922).
 * Per-method typeof/PORT_KEYS theater lives in host-ports suites; here we only
 * assert the composite key set + one observable RPC per domain.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startServiceHost } from "@collector/service/host";
import { createCollectorHostService } from "./host-collector-client.js";
import { useTempDataDirs } from "./host-collector-client-test-harness.js";
import { createHttpHostTransport } from "./http-host-transport.js";

const COLLECTOR_SERVICE_KEYS = [
  "boot",
  "credentials",
  "extract",
  "folders",
  "index",
  "items",
  "jobs",
  "media",
  "settings",
  "syncPlugins",
  "tags",
  "telegramSync",
  "vaults",
] as const;

describe("CollectorHostService live port smoke (#366 / #922)", () => {
  const { mktemp } = useTempDataDirs();

  it("one observable RPC per domain port over createCollectorHostService", async () => {
    const dataDir = mktemp("collector-host-ports-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: readFileSync(
          join(dataDir, "collector-service.host-token"),
          "utf8",
        ).trim(),
      });
      try {
        const service = createCollectorHostService(transport);
        expect(Object.keys(service).sort()).toEqual(
          [...COLLECTOR_SERVICE_KEYS].sort(),
        );

        const dataDirectory = await service.boot.getDataDirectory();
        expect(dataDirectory).toBe(dataDir);

        const page = await service.items.queryIndex("all", undefined, {
          limit: 1,
          offset: 0,
        });
        expect(page.offset).toBe(0);
        expect(typeof page.total).toBe("number");
        expect(Array.isArray(page.ids)).toBe(true);
        expect(page.stamps).toHaveLength(page.ids.length);

        const tags = await service.tags.listTags();
        expect(Array.isArray(tags)).toBe(true);

        const tree = await service.folders.listFolderTree();
        expect(Array.isArray(tree)).toBe(true);

        const item = await service.items.createItem({
          title: "port-smoke",
          content_type: "note",
          content: "# port smoke",
        });
        expect(item.title).toBe("port-smoke");
        const media = await service.media.listItemMedia(item.id);
        expect(media).toEqual([]);

        const vaults = await service.vaults.listVaults();
        expect(vaults.length).toBeGreaterThan(0);

        const syncStatus = service.index.getVaultIndexSyncStatus();
        expect(["idle", "rebuilding", "running", "done"]).toContain(
          syncStatus.status,
        );

        const settings = await service.settings.ensureAppSettings();
        expect(["light", "dark"]).toContain(settings.theme);

        const credAvail = await service.credentials.getCredentialsAvailability();
        expect(typeof credAvail.available).toBe("boolean");
        if (credAvail.available) {
          const ref = { pluginId: "collector", key: "issue30_ipc_probe" };
          await service.credentials.setCredential({
            ...ref,
            secret: "ipc-probe-secret",
          });
          await expect(service.credentials.getCredential(ref)).resolves.toBe(
            "ipc-probe-secret",
          );
          await service.credentials.deleteCredential(ref);
          await expect(
            service.credentials.getCredential(ref),
          ).resolves.toBeNull();
        }
      } finally {
        await transport.close();
      }
    } finally {
      await host.close();
    }
  });
});
