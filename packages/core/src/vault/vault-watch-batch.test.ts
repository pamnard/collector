import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import {
  createVaultWatchBatcher,
  dedupeVaultWatchItemIds,
  type VaultWatchBatch,
} from "./vault-watch-batch.js";
import { joinSegments } from "./paths.js";
import { resolveVaultWatchTarget } from "./vault-watch-path.js";

describe("dedupeVaultWatchItemIds", () => {
  it("keeps first occurrence order", () => {
    expect(dedupeVaultWatchItemIds(["b", "a", "b", "c"])).toEqual(["b", "a", "c"]);
  });
});

describe("createVaultWatchBatcher", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("coalesces classified vault FS paths into one flush batch", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-watch-batch-"));
    await fs.mkdir(joinSegments(dataDir, "Parent", "Child"));
    await fs.mkdir(joinSegments(dataDir, "Inbox"));
    await fs.writeText(joinSegments(dataDir, "note.md"), "---\ntitle: n\n---\n");
    await fs.writeText(
      joinSegments(dataDir, "Inbox", "other.md"),
      "---\ntitle: o\n---\n",
    );

    const flushes: VaultWatchBatch[] = [];
    let resolveFlush: (() => void) | undefined;
    const flushed = new Promise<void>((resolve) => {
      resolveFlush = resolve;
    });

    const batcher = createVaultWatchBatcher({
      debounceMs: 25,
      onFlush: (batch) => {
        flushes.push(batch);
        resolveFlush?.();
      },
    });

    const changedPaths = [
      joinSegments(dataDir, "note.md"),
      joinSegments(dataDir, "Parent", "Child"),
      joinSegments(dataDir, "note.md"),
      joinSegments(dataDir, "Inbox", "other.md"),
      joinSegments(dataDir, "Parent", "Child"),
    ];
    for (const changedPath of changedPaths) {
      const target = await resolveVaultWatchTarget(fs, dataDir, changedPath);
      if (target === null) {
        throw new Error(`unclassified vault watch path: ${changedPath}`);
      }
      if (target.kind === "item") {
        batcher.enqueueItem(target.itemId);
      } else {
        batcher.enqueueFolder(target.folderPath);
      }
    }

    await flushed;
    batcher.dispose();

    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toEqual({
      itemIds: ["note.md", "Inbox/other.md"],
      folderPaths: ["Parent/Child"],
    });
  });

  it("batches folder prefixes with item ids (#567)", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const batcher = createVaultWatchBatcher({
      debounceMs: 100,
      onFlush,
    });

    batcher.enqueueFolder("Parent/Child");
    batcher.enqueueItem("note.md");
    batcher.enqueueFolder("Parent/Child");
    vi.advanceTimersByTime(100);

    expect(onFlush).toHaveBeenCalledWith({
      itemIds: ["note.md"],
      folderPaths: ["Parent/Child"],
    });

    batcher.dispose();
    vi.useRealTimers();
  });

  it("flush runs immediately", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const batcher = createVaultWatchBatcher({
      debounceMs: 100,
      onFlush,
    });

    batcher.enqueueItem("a");
    batcher.flush();
    expect(onFlush).toHaveBeenCalledTimes(1);

    batcher.dispose();
    vi.useRealTimers();
  });
});
