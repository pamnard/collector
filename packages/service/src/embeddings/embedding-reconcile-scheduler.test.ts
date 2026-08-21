import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_MODEL_ID } from "@collector/core";
import {
  createEmbeddingReconcileScheduler,
  DEFAULT_EMBEDDING_RECONCILE_BATCH_SIZE,
  DEFAULT_EMBEDDING_RECONCILE_INTERVAL_MS,
  DEFAULT_EMBEDDING_RECONCILE_SCAN_LIMIT,
} from "./embedding-reconcile-scheduler.js";

describe("createEmbeddingReconcileScheduler (#742)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("documents default interval and batch caps", () => {
    expect(DEFAULT_EMBEDDING_RECONCILE_INTERVAL_MS).toBe(180_000);
    expect(DEFAULT_EMBEDDING_RECONCILE_BATCH_SIZE).toBe(50);
    expect(DEFAULT_EMBEDDING_RECONCILE_SCAN_LIMIT).toBe(200);
  });

  it("runTick enqueues per item and logs scanned/enqueued/skipped/deferred/errors", async () => {
    const planTick = vi.fn(async () => ({
      inputs: [
        {
          itemId: "a.md",
          title: "Garden",
          description: "plants",
          tagNames: [] as string[],
          contentRevision: 1,
        },
        {
          itemId: "b.md",
          title: "Roses",
          description: "flowers",
          tagNames: [] as string[],
          contentRevision: 2,
        },
      ],
      stats: {
        scanned: 3,
        skippedNoSignal: 1,
        deferred: 0,
        batchFull: false,
      },
      nextAfterItemId: "b.md",
    }));
    const enqueueRefresh = vi.fn(async (_vaultId: string, inputs: { itemId: string }[]) => {
      if (inputs[0]?.itemId === "b.md") {
        throw new Error("enqueue failed");
      }
    });
    const logTick = vi.fn();
    const getDb = vi.fn(() => ({}) as never);

    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => "v1",
      getDb,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh,
      planTick,
      logTick,
    });

    const log = await scheduler.runTick();
    expect(planTick).toHaveBeenCalledWith(getDb(), {
      vaultId: "v1",
      modelId: EMBEDDING_MODEL_ID,
      batchSize: DEFAULT_EMBEDDING_RECONCILE_BATCH_SIZE,
      scanLimit: DEFAULT_EMBEDDING_RECONCILE_SCAN_LIMIT,
    });
    expect(enqueueRefresh).toHaveBeenCalledTimes(2);
    expect(enqueueRefresh).toHaveBeenNthCalledWith(1, "v1", [
      expect.objectContaining({ itemId: "a.md" }),
    ]);
    expect(log).toEqual({
      vaultId: "v1",
      scanned: 3,
      enqueued: 1,
      skippedNoSignal: 1,
      deferred: 0,
      batchFull: false,
      errors: 1,
    });
    expect(logTick).toHaveBeenCalledWith(log);
    scheduler.dispose();
  });

  it("default logTick uses console.error when errors > 0", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const planTick = vi.fn(async () => ({
      inputs: [
        {
          itemId: "a.md",
          title: "Garden",
          description: "plants",
          tagNames: [] as string[],
          contentRevision: 1,
        },
      ],
      stats: {
        scanned: 1,
        skippedNoSignal: 0,
        deferred: 0,
        batchFull: false,
      },
      nextAfterItemId: "a.md",
    }));
    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => "v1",
      getDb: () => ({}) as never,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: async () => {
        throw new Error("enqueue failed");
      },
      planTick,
    });

    await scheduler.runTick();
    expect(errorSpy).toHaveBeenCalledWith(
      "[collector] embedding reconcile tick",
      expect.objectContaining({ errors: 1 }),
    );
    expect(infoSpy).not.toHaveBeenCalledWith(
      "[collector] embedding reconcile tick",
      expect.anything(),
    );
    scheduler.dispose();
  });

  it("advances keyset cursor across ticks and wraps past the end", async () => {
    const planTick = vi
      .fn()
      .mockResolvedValueOnce({
        inputs: [
          {
            itemId: "a.md",
            title: "A",
            description: "a",
            tagNames: [] as string[],
            contentRevision: 1,
          },
        ],
        stats: {
          scanned: 2,
          skippedNoSignal: 0,
          deferred: 1,
          batchFull: true,
        },
        nextAfterItemId: "a.md",
      })
      .mockResolvedValueOnce({
        inputs: [
          {
            itemId: "b.md",
            title: "B",
            description: "b",
            tagNames: [] as string[],
            contentRevision: 1,
          },
        ],
        stats: {
          scanned: 1,
          skippedNoSignal: 0,
          deferred: 0,
          batchFull: false,
        },
        nextAfterItemId: "b.md",
      })
      .mockResolvedValueOnce({
        inputs: [],
        stats: {
          scanned: 0,
          skippedNoSignal: 0,
          deferred: 0,
          batchFull: false,
        },
        nextAfterItemId: null,
      })
      .mockResolvedValueOnce({
        inputs: [
          {
            itemId: "a.md",
            title: "A",
            description: "a",
            tagNames: [] as string[],
            contentRevision: 1,
          },
        ],
        stats: {
          scanned: 1,
          skippedNoSignal: 0,
          deferred: 0,
          batchFull: false,
        },
        nextAfterItemId: "a.md",
      });

    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => "v1",
      getDb: () => ({}) as never,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: async () => undefined,
      planTick,
    });

    const first = await scheduler.runTick();
    expect(first?.batchFull).toBe(true);
    expect(first?.deferred).toBe(1);
    expect(planTick).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.not.objectContaining({ afterItemId: expect.anything() }),
    );

    await scheduler.runTick();
    expect(planTick).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ afterItemId: "a.md" }),
    );

    // Past end: empty scan with cursor → wrap and rescan from start in same tick.
    const wrapped = await scheduler.runTick();
    expect(planTick).toHaveBeenCalledTimes(4);
    expect(planTick.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({ afterItemId: "b.md" }),
    );
    expect(planTick.mock.calls[3]?.[1]).not.toHaveProperty("afterItemId");
    expect(wrapped?.enqueued).toBe(1);
    scheduler.dispose();
  });

  it("runTick is a no-op when host is unhealthy or vault missing", async () => {
    const planTick = vi.fn(async () => ({
      inputs: [],
      stats: {
        scanned: 0,
        skippedNoSignal: 0,
        deferred: 0,
        batchFull: false,
      },
      nextAfterItemId: null,
    }));
    const enqueueRefresh = vi.fn(async () => undefined);

    const unhealthy = createEmbeddingReconcileScheduler({
      isHealthy: () => false,
      resolveActiveVaultId: () => "v1",
      getDb: () => ({}) as never,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh,
      planTick,
    });
    expect(await unhealthy.runTick()).toBeNull();
    expect(planTick).not.toHaveBeenCalled();
    unhealthy.dispose();

    const noVault = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => null,
      getDb: () => ({}) as never,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh,
      planTick,
    });
    expect(await noVault.runTick()).toBeNull();
    expect(planTick).not.toHaveBeenCalled();
    noVault.dispose();
  });

  it("start wakes immediately and arms interval; dispose clears it", async () => {
    vi.useFakeTimers();
    const planTick = vi.fn(async () => ({
      inputs: [],
      stats: {
        scanned: 0,
        skippedNoSignal: 0,
        deferred: 0,
        batchFull: false,
      },
      nextAfterItemId: null,
    }));
    const logTick = vi.fn();
    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => "v1",
      getDb: () => ({}) as never,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: async () => undefined,
      planTick,
      intervalMs: 5_000,
      logTick,
    });
    scheduler.start();
    await vi.waitFor(() => {
      expect(planTick).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(planTick).toHaveBeenCalledTimes(2);
    });
    scheduler.dispose();
    planTick.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(planTick).not.toHaveBeenCalled();
  });

  it("onTickError surfaces planning failures at error severity", async () => {
    vi.useFakeTimers();
    const onTickError = vi.fn();
    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => "v1",
      getDb: () => ({}) as never,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: async () => undefined,
      planTick: async () => {
        throw new Error("plan failed");
      },
      onTickError,
      intervalMs: 1_000,
    });
    scheduler.start();
    // Immediate wake from start() surfaces the planning failure.
    await vi.waitFor(() => {
      expect(onTickError).toHaveBeenCalled();
    });
    expect(String(onTickError.mock.calls[0]?.[0])).toContain("plan failed");
    scheduler.dispose();
  });

  it("wake after start re-runs when vault becomes available (boot order)", async () => {
    vi.useFakeTimers();
    let vaultId: string | null = null;
    let resolveCalls = 0;
    const planTick = vi.fn(async () => ({
      inputs: [],
      stats: {
        scanned: 0,
        missing: 0,
        staleModel: 0,
        enqueued: 0,
        skippedNoSignal: 0,
        deferred: 0,
        batchFull: false,
      },
      nextAfterItemId: null,
    }));
    const scheduler = createEmbeddingReconcileScheduler({
      isHealthy: () => true,
      resolveActiveVaultId: () => {
        resolveCalls += 1;
        return vaultId;
      },
      getDb: () => ({}) as never,
      getModelId: () => EMBEDDING_MODEL_ID,
      enqueueRefresh: async () => undefined,
      planTick,
      intervalMs: 60_000,
    });
    scheduler.start();
    // First wake from start() sees no vault and skips planning.
    await vi.waitFor(() => {
      expect(resolveCalls).toBeGreaterThan(0);
    });
    expect(planTick).not.toHaveBeenCalled();
    // Simulate ensureActiveVault / notifyVaultReady after open().
    vaultId = "v1";
    scheduler.wake();
    await vi.waitFor(() => {
      expect(planTick).toHaveBeenCalledTimes(1);
    });
    scheduler.dispose();
  });
});
