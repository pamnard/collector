import { describe, expect, it, vi } from "vitest";
import { startServiceHost } from "@collector/service/host";
import { useTempDataDirs } from "./host-collector-client-test-harness.js";
import { connectCollectorHostService } from "./host-collector-client-node.js";

describe("CollectorHostServiceClient health/reads (#155 / #922)", () => {
  const { mktemp } = useTempDataDirs();

  it("health works end-to-end against the service host", async () => {
    const dataDir = mktemp("collector-host-client-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        expect(await client.ping()).toEqual({ ok: true, pong: true });
        expect(await client.health()).toMatchObject({
          ok: true,
          healthy: true,
          status: "healthy",
        });
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("item/search/dashboard reads work over HTTP (#155)", async () => {
    const dataDir = mktemp("collector-host-reads-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        let page = await client.items.fetchDashboardIndexPage("all", "", {
          limit: 60,
          offset: 0,
        });
        await vi.waitFor(async () => {
          page = await client.items.fetchDashboardIndexPage("all", "", {
            limit: 60,
            offset: 0,
          });
          expect(page.totalCount).toBeGreaterThan(0);
        });
        expect(page.itemIds.length).toBeGreaterThan(0);

        const ids = await client.items.listDashboardItemIds("all", "");
        expect(ids.totalCount).toBe(page.totalCount);
        expect(ids.itemIds.length).toBeGreaterThan(0);

        const loaded = await client.items.loadDashboardItems(ids.itemIds, 0, 10);
        expect(loaded.length).toBeGreaterThan(0);

        const firstId = ids.itemIds[0]!;
        const byId = await client.items.getItemById(firstId);
        expect(byId.item.id).toBe(firstId);

        const source = await client.items.getItemSource(firstId);
        expect(typeof source).toBe("string");
        expect(source.length).toBeGreaterThan(0);

        const tags = await client.tags.listTags();
        expect(Array.isArray(tags)).toBe(true);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });
});
