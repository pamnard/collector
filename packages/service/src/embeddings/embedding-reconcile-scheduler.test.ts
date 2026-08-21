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
  });

  it("documents default interval and batch caps", () => {
    expect(DEFAULT_EMBEDDING_RECONCILE_INTERVAL_MS).toBe(180_000);
    expect(DEFAULT_EMBEDDING_RECONCILE_BATCH_SIZE).toBe(50);
    expect(DEFAULT_EMBEDDING_RECONCILE_SCAN_LIMIT).toBe(200);
  });

  it("runTick enqueues per item and logs scanned/enqueued/skipped/errors", async () => {
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
      stats: { scanned: 3, skippedNoSignal: 1 },
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
      errors: 1,
    });
    expect(logTick).toHaveBeenCalledWith(log);
    scheduler.dispose();
  });

  it("runTick is a no-op when host is unhealthy or vault missing", async () => {
    const planTick = vi.fn(async () => ({
      inputs: [],
      stats: { scanned: 0, skippedNoSignal: 0 },
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

  it("start arms interval and dispose clears it", async () => {
    vi.useFakeTimers();
    const planTick = vi.fn(async () => ({
      inputs: [],
      stats: { scanned: 0, skippedNoSignal: 0 },
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
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => {
      expect(planTick).toHaveBeenCalled();
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
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => {
      expect(onTickError).toHaveBeenCalled();
    });
    expect(String(onTickError.mock.calls[0]?.[0])).toContain("plan failed");
    scheduler.dispose();
  });
});
