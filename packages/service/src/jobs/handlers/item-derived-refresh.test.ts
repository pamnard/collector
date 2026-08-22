import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  itemDerivedRefreshIdempotencyKey,
  itemDerivedRefreshJobType,
} from "@collector/shared";
import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createItemDerivedRefreshHandler,
  enqueueItemDerivedRefresh,
} from "./item-derived-refresh.js";

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("waitFor timed out");
}

const samplePayload = {
  vaultId: "vault-1",
  vaultPath: "/tmp/vault",
  itemId: "Inbox/note.md",
  contentRevision: 3,
  fileMtimeMs: 1_700_000_000_000,
  itemUrl: null,
};

describe("itemDerivedRefresh job (#766 / #768)", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses shared idempotency key including fileMtimeMs", () => {
    expect(itemDerivedRefreshIdempotencyKey(samplePayload)).toBe(
      "itemDerivedRefresh:vault-1:Inbox/note.md:3:1700000000000",
    );
  });

  it("parses optional itemUrl in catalog payload", () => {
    expect(
      itemDerivedRefreshJobType.payload.parse({
        vaultId: "v",
        vaultPath: "/p",
        itemId: "a.md",
        contentRevision: 1,
        fileMtimeMs: 1,
        itemUrl: "https://example.com",
      }),
    ).toMatchObject({
      itemUrl: "https://example.com",
    });
  });

  it("localizes then upserts index from vault bytes", async () => {
    const localize = vi.fn(async () => "noop" as const);
    const upsert = vi.fn(async () => "upserted" as const);
    const localizeSpy = vi
      .spyOn(await import("@collector/core"), "runItemDerivedLocalizeRefresh")
      .mockImplementation(localize);
    const upsertSpy = vi
      .spyOn(await import("@collector/core"), "upsertItemIndexFromVault")
      .mockImplementation(upsert);
    const readItemFile = vi.fn(async () => ({
      id: samplePayload.itemId,
      folder_path: "Inbox",
      content_revision: 3,
      vault_id: samplePayload.vaultId,
    }));
    vi.spyOn(await import("@collector/core"), "readItemFile").mockImplementation(
      readItemFile as never,
    );

    const onVaultPresentationChanged = vi.fn();
    const handler = createItemDerivedRefreshHandler({
      getContext: () =>
        ({
          fs: {
            exists: async () => true,
            stat: async () => ({ mtimeMs: samplePayload.fileMtimeMs }),
          },
          index: {},
        }) as never,
      localizeRemoteDisplayAssets: vi.fn(),
      onVaultPresentationChanged,
    });

    await expect(
      handler({
        id: "job-1",
        type: "itemDerivedRefresh",
        attempts: 0,
        payload: samplePayload,
      }),
    ).resolves.toEqual({ status: "ok" });

    expect(localize).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.anything(),
      samplePayload.vaultPath,
      samplePayload.vaultId,
      samplePayload.itemId,
      3,
      samplePayload.fileMtimeMs,
    );
    expect(onVaultPresentationChanged).toHaveBeenCalledWith({
      vaultId: samplePayload.vaultId,
      kind: "itemDerivedComplete",
      itemId: samplePayload.itemId,
      folderPath: "Inbox",
    });

    localizeSpy.mockRestore();
    upsertSpy.mockRestore();
  });

  it("returns ok when item was deleted before localize runs", async () => {
    const onVaultPresentationChanged = vi.fn();
    const localizeRemoteDisplayAssets = vi.fn();
    const handler = createItemDerivedRefreshHandler({
      getContext: () => ({
        fs: {
          exists: async () => false,
        },
        index: { listItemSyncMetaByIds: async () => [] },
      }) as never,
      localizeRemoteDisplayAssets,
      onVaultPresentationChanged,
    });

    await expect(
      handler({
        id: "job-1",
        type: "itemDerivedRefresh",
        attempts: 0,
        payload: {
          vaultId: "vault-1",
          vaultPath: "/vault",
          itemId: "Inbox/n.md",
          contentRevision: 1,
          fileMtimeMs: 100,
        },
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(localizeRemoteDisplayAssets).not.toHaveBeenCalled();
    expect(onVaultPresentationChanged).not.toHaveBeenCalled();
  });

  it("dedupes pending jobs for the same snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-item-derived-job-"));
    dirs.push(dir);
    vi.spyOn(
      await import("@collector/core"),
      "runItemDerivedLocalizeRefresh",
    ).mockResolvedValue("noop");
    vi.spyOn(
      await import("@collector/core"),
      "upsertItemIndexFromVault",
    ).mockResolvedValue("upserted");
    vi.spyOn(await import("@collector/core"), "readItemFile").mockResolvedValue({
      id: samplePayload.itemId,
      folder_path: "Inbox",
      content_revision: 3,
      vault_id: samplePayload.vaultId,
    } as never);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registry = createJobRegistry([itemDerivedRefreshJobType]);
    registry.register(itemDerivedRefreshJobType, async (job) => {
      await gate;
      return createItemDerivedRefreshHandler({
        getContext: () =>
          ({
            fs: {
              exists: async () => true,
              stat: async () => ({ mtimeMs: samplePayload.fileMtimeMs }),
            },
            index: {},
          }) as never,
        localizeRemoteDisplayAssets: vi.fn(),
      })(job);
    });
    const queue = await createJobQueue({
      dbPath: join(dir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const first = await enqueueItemDerivedRefresh(queue, samplePayload);
    await waitFor(async () => (await queue.stats()).running === 1);
    const second = await enqueueItemDerivedRefresh(queue, samplePayload);

    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });

    release();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
  });
});
