import { describe, expect, it, vi } from "vitest";
import { startServiceHost } from "@collector/service/host";
import { useTempDataDirs } from "./host-collector-client-test-harness.js";
import { connectCollectorHostService } from "./host-collector-client-node.js";

describe("CollectorHostServiceClient tags/folders (#158 / #842 / #922)", () => {
  const { mktemp } = useTempDataDirs();

  it("tags list is derived from item writes; reverse catalog RPC absent (#842)", async () => {
    const dataDir = mktemp("collector-host-tags-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        expect(client.tags).not.toHaveProperty("createTag");
        expect(client.tags).not.toHaveProperty("deleteTag");
        expect(client.tags).not.toHaveProperty("updateTagRecord");

        const item = await client.items.createItem({
          title: "Tagged",
          content_type: "note",
          content: "body",
        });
        const updated = await client.items.updateItem(item.id, {
          tags: ["host-tag"],
        });
        expect(updated.tag_ids).toHaveLength(1);

        const source = await client.items.getItemSource(item.id);
        expect(source).toMatch(/host-tag/);

        await vi.waitFor(
          async () => {
            const listed = await client.tags.listTags();
            expect(listed.some((t) => t.name === "host-tag")).toBe(true);
            expect(listed.find((t) => t.name === "host-tag")?.item_count).toBe(
              1,
            );
          },
          { timeout: 10_000 },
        );
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("folders + move item work over HTTP (#158)", async () => {
    const dataDir = mktemp("collector-host-folders-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        const createdPath = await client.folders.createFolder("host-folder");
        expect(createdPath).toBe("host-folder");

        // Index tree may lag FS until sync; still exercise list RPC.
        expect(Array.isArray(await client.folders.listFolderTree())).toBe(true);

        await expect(
          client.folders.listFolderItems(createdPath),
        ).resolves.toEqual([]);

        const renamed = await client.folders.renameFolder(
          createdPath,
          "host-folder-renamed",
        );
        expect(renamed).toBe("host-folder-renamed");

        const item = await client.items.createItem({
          title: "Folder move note",
          content_type: "note",
          content: "x",
        });
        const moved = await client.folders.moveItemToFolderPath(item.id, renamed);
        expect(moved.folder_path).toBe(renamed);

        const listed = await client.folders.listFolderItems(renamed);
        expect(listed.map((row) => row.id)).toEqual([moved.id]);
        await expect(
          client.folders.listFolderItems("missing-folder-xyz"),
        ).rejects.toThrow(/Folder not found/);

        await client.items.deleteItem(moved.id);
        await client.folders.deleteFolder(renamed);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });
});
