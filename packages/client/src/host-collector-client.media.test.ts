import { describe, expect, it } from "vitest";
import { startServiceHost } from "@collector/service/host";
import {
  useTempDataDirs,
  waitForItemIndexed,
} from "./host-collector-client-test-harness.js";
import { connectCollectorHostService } from "./host-collector-client-node.js";

describe("CollectorHostServiceClient media (#159 / #353 / #922)", () => {
  const { mktemp } = useTempDataDirs();

  it("media attach/list/delete work over HTTP (#159)", async () => {
    const dataDir = mktemp("collector-host-media-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        const item = await client.items.createItem({
          title: "Media note",
          content_type: "note",
          content: "m",
        });

        // Minimal 1x1 PNG
        const png = Uint8Array.from(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            "base64",
          ),
        );
        const attached = await client.media.attachMediaFiles(item.id, [
          { name: "dot.png", bytes: png },
        ]);
        expect(attached.length).toBe(1);
        expect(attached[0]!.filename).toBe("dot.png");

        const listed = await client.media.listItemMedia(item.id);
        expect(listed.some((m) => m.id === attached[0]!.id)).toBe(true);

        const thumb = await client.media.resolveItemThumbnailPath(item);
        expect(thumb === null || typeof thumb === "string").toBe(true);

        const thumbs = await client.media.resolveItemThumbnailPaths([item]);
        expect(thumbs instanceof Map).toBe(true);
        expect(thumbs.has(item.id)).toBe(true);

        await client.media.deleteItemMedia(item.id, attached[0]!.id);
        const after = await client.media.listItemMedia(item.id);
        expect(after.some((m) => m.id === attached[0]!.id)).toBe(false);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("media replace keeps stable id over HTTP (#353)", async () => {
    const dataDir = mktemp("collector-host-media-replace-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        const item = await client.items.createItem({
          title: "Replace media note",
          content_type: "note",
          content: "m",
        });
        await waitForItemIndexed(client, item.id);

        const png = Uint8Array.from(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            "base64",
          ),
        );
        const attached = await client.media.attachMediaFiles(item.id, [
          { name: "dot.png", bytes: png },
        ]);
        expect(attached.length).toBe(1);
        const mediaId = attached[0]!.id;

        const replaced = await client.media.replaceItemMedia(item.id, mediaId, {
          name: "dot2.png",
          bytes: png,
        });
        expect(replaced.id).toBe(mediaId);
        expect(replaced.filename).toBe("dot2.png");

        const listed = await client.media.listItemMedia(item.id);
        expect(listed).toHaveLength(1);
        expect(listed[0]!.id).toBe(mediaId);
        expect(listed[0]!.filename).toBe("dot2.png");

        const covered = await client.media.setItemCoverFromMedia(item.id, mediaId);
        expect(covered.id).toBe(item.id);
        // Cover SoT is cover.webp on disk (#276/#279); FM thumbnail stays null.
        expect(covered.thumbnail ?? null).toBeNull();
        const coverPath = await client.media.resolveItemThumbnailPath(covered);
        expect(typeof coverPath).toBe("string");
        expect(coverPath!.length).toBeGreaterThan(0);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });
});
