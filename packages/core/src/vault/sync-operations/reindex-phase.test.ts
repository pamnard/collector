import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "../../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../../index/sql-index.js";
import { MemorySqlAdapter } from "../../testing/memory-sql.js";
import { createId } from "../../util/ids.js";
import * as concurrency from "../../util/concurrency.js";
import { DISK_ITEM_READ_CONCURRENCY } from "../../util/concurrency.js";
import {
  itemFileFromDocumentMarkdown,
  loadTagMaps,
  type TagMapsHolder,
} from "../item-io.js";
import { readTagsFile } from "../tag-io.js";
import { itemMarkdownPath } from "../paths.js";
import { createVault } from "../vault-operations.js";
import { hydrateReindexQueue } from "./reindex-phase.js";
import type { ReindexWork } from "./types.js";

describe("hydrateReindexQueue", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedVault() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-hydrate-reindex-"));
    const ctx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    return createVault(ctx, dataDir, { name: "Vault" });
  }

  function documentMarkdown(title: string, tags: string[]): string {
    const tagLines =
      tags.length === 0
        ? ""
        : `tags:\n${tags.map((tag) => `  - ${tag}`).join("\n")}\n`;
    return `---
title: ${title}
${tagLines}created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---
body
`;
  }

  it("parses queued documents with bounded concurrency", async () => {
    const { meta, path } = await seedVault();
    const itemCount = DISK_ITEM_READ_CONCURRENCY + 2;
    const reindexQueue: ReindexWork[] = [];
    const diskMtimeMs = Date.now();

    for (let i = 0; i < itemCount; i += 1) {
      const itemId = `${createId()}.md`;
      const markdown = documentMarkdown(`Note ${i}`, []);
      await fs.writeText(itemMarkdownPath(path, itemId), markdown);
      reindexQueue.push({ itemId, diskMtimeMs });
    }

    const poolPeaks: number[] = [];
    const original = concurrency.runWithConcurrencyYielding;
    const runSpy = vi
      .spyOn(concurrency, "runWithConcurrencyYielding")
      .mockImplementation(async (count, conc, fn, options) => {
        let peakInFlight = 0;
        let inFlight = 0;
        const result = await original(
          count,
          conc,
          async (index) => {
            inFlight += 1;
            peakInFlight = Math.max(peakInFlight, inFlight);
            try {
              await new Promise((resolve) => setTimeout(resolve, 15));
              return await fn(index);
            } finally {
              inFlight -= 1;
            }
          },
          options,
        );
        poolPeaks.push(peakInFlight);
        return result;
      });

    const tagMaps: TagMapsHolder = { maps: await loadTagMaps(fs, path) };
    await hydrateReindexQueue(
      { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) },
      path,
      meta.id,
      tagMaps,
      reindexQueue,
    );

    expect(reindexQueue.every((work) => work.item)).toBe(true);
    // Batch meta read + hydrate parse each use the disk-item concurrency pool.
    expect(
      runSpy.mock.calls.filter(
        ([count, conc]) =>
          count === itemCount && conc === DISK_ITEM_READ_CONCURRENCY,
      ),
    ).toHaveLength(2);
    expect(Math.max(...poolPeaks)).toBeGreaterThan(1);
    expect(Math.max(...poolPeaks)).toBeLessThanOrEqual(
      DISK_ITEM_READ_CONCURRENCY,
    );
  });

  it("keeps TagMapsHolder and tags.json consistent under concurrent missing tags", async () => {
    const { meta, path } = await seedVault();
    const diskMtimeMs = Date.now();
    const tagNames = Array.from(
      { length: DISK_ITEM_READ_CONCURRENCY + 2 },
      (_, i) => `Tag${i}`,
    );
    const reindexQueue: ReindexWork[] = [];

    for (const tagName of tagNames) {
      const itemId = `${createId()}.md`;
      await fs.writeText(
        itemMarkdownPath(path, itemId),
        documentMarkdown(tagName, [tagName]),
      );
      reindexQueue.push({ itemId, diskMtimeMs });
    }

    const tagMaps: TagMapsHolder = { maps: await loadTagMaps(fs, path) };
    await hydrateReindexQueue(
      { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) },
      path,
      meta.id,
      tagMaps,
      reindexQueue,
    );

    expect(reindexQueue.every((work) => work.item)).toBe(true);
    for (const tagName of tagNames) {
      expect(tagMaps.maps.byName.has(tagName.toLowerCase())).toBe(true);
    }

    const onDisk = await readTagsFile(fs, path);
    expect(onDisk.tags.map((tag) => tag.name).sort()).toEqual(
      [...tagNames].sort(),
    );
    expect(onDisk.tags).toHaveLength(tagNames.length);

    for (const work of reindexQueue) {
      const resolved = await itemFileFromDocumentMarkdown(
        fs,
        path,
        meta.id,
        work.itemId,
        await fs.readText(itemMarkdownPath(path, work.itemId)),
        diskMtimeMs,
        tagMaps,
      );
      expect(work.item!.tag_ids).toEqual(resolved.tag_ids);
    }
  });
});
