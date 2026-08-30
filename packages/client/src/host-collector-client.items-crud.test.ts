import { describe, expect, it, vi } from "vitest";
import { startServiceHost } from "@collector/service/host";
import {
  useTempDataDirs,
  waitForItemIndexed,
} from "./host-collector-client-test-harness.js";
import { connectCollectorHostService } from "./host-collector-client-node.js";

describe("CollectorHostServiceClient items CRUD (#156 / #922)", () => {
  const { mktemp } = useTempDataDirs();

  it(
    "item create/update/delete work over HTTP (#156)",
    async () => {
    const dataDir = mktemp("collector-host-writes-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        const created = await client.items.createItem({
          title: "Host Note",
          content_type: "note",
          content: "# hello",
        });
        expect(created.title).toBe("Host Note");

        await waitForItemIndexed(client, created.id);
        const before = await client.items.queryIndex("all", undefined, {
          limit: 24,
          offset: 0,
        });
        expect(before.ids).toContain(created.id);
        expect(before.stamps).toHaveLength(before.ids.length);

        const presentationEvents: Array<{ vaultId: string; kind: string }> = [];
        const unsubPresentation = client.index.subscribeVaultPresentationChanged(
          (payload) => {
            presentationEvents.push(payload);
          },
        );

        const updated = await client.items.updateItem(created.id, {
          title: "Host Note 2",
          description: "fresh teaser",
        });
        expect(updated.title).toBe("Host Note 2");

        // Derived refresh from create may still emit itemDerivedComplete after
        // subscribe; wait for the upsert event the update path guarantees (#817).
        await vi.waitFor(() => {
          expect(
            presentationEvents.some((event) => event.kind === "itemUpserted"),
          ).toBe(true);
        });
        unsubPresentation.unsubscribe();

        await vi.waitFor(async () => {
          const after = await client.items.getItemById(created.id);
          expect(after.item.title).toBe("Host Note 2");
          const indexed = await client.items.queryIndex("all", undefined, {
            limit: 24,
            offset: 0,
          });
          expect(indexed.ids).toContain(created.id);
          const afterStamp = indexed.stamps[indexed.ids.indexOf(created.id)];
          expect(typeof afterStamp).toBe("string");
          expect(afterStamp!.length).toBeGreaterThan(0);
        });

        const source = await client.items.updateItemSource(
          created.id,
          "---\ntitle: Host Note 2\n---\n\n# body\n",
        );
        expect(source.id).toBe(created.id);

        await client.items.deleteItem(created.id);
        await expect(client.items.getItemById(created.id)).rejects.toThrow();
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  },
  15_000,
  );
});
