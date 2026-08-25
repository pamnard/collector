import { describe, expect, it, vi } from "vitest";
import { itemDerivedRefreshJobType } from "@collector/shared";
import {
  createDerivedCatchUpStatusRefresher,
  createDerivedCatchUpStatusStore,
  deriveCatchUpStatusFromJobStats,
} from "./derived-catch-up-status.js";

const emptyStats = {
  pending: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
  byType: {},
};

describe("deriveCatchUpStatusFromJobStats (#767)", () => {
  it("is idle when no derived jobs are active", () => {
    expect(
      deriveCatchUpStatusFromJobStats(emptyStats, "vault-1"),
    ).toEqual({
      vaultId: null,
      status: "idle",
      pending: 0,
      running: 0,
    });
  });

  it("is running with counts when derived jobs are queued", () => {
    expect(
      deriveCatchUpStatusFromJobStats(
        {
          ...emptyStats,
          pending: 2,
          byType: {
            [itemDerivedRefreshJobType.id]: {
              pending: 2,
              running: 1,
              succeeded: 0,
              failed: 0,
              cancelled: 0,
            },
          },
        },
        "vault-1",
      ),
    ).toEqual({
      vaultId: "vault-1",
      status: "running",
      pending: 2,
      running: 1,
    });
  });
});

describe("createDerivedCatchUpStatusStore", () => {
  it("notifies subscribers on set and skips no-op updates", () => {
    const store = createDerivedCatchUpStatusStore();
    const seen: unknown[] = [];
    const unsub = store.subscribe((status) => {
      seen.push(status);
    });

    store.set({
      vaultId: "v1",
      status: "running",
      pending: 1,
      running: 0,
    });
    store.set({
      vaultId: "v1",
      status: "running",
      pending: 1,
      running: 0,
    });
    store.set({
      vaultId: null,
      status: "idle",
      pending: 0,
      running: 0,
    });

    unsub.unsubscribe();
    expect(seen).toHaveLength(3);
    expect(store.get().status).toBe("idle");
  });
});

describe("createDerivedCatchUpStatusRefresher", () => {
  it("reads job stats and updates the store", async () => {
    const store = createDerivedCatchUpStatusStore();
    const stats = vi.fn(async () => ({
      ...emptyStats,
      pending: 1,
      byType: {
        [itemDerivedRefreshJobType.id]: {
          pending: 1,
          running: 0,
          succeeded: 0,
          failed: 0,
          cancelled: 0,
        },
      },
    }));
    const refresher = createDerivedCatchUpStatusRefresher({
      store,
      stats,
      getActiveVaultId: () => "vault-a",
    });

    await refresher.refresh();

    expect(stats).toHaveBeenCalledOnce();
    expect(store.get()).toEqual({
      vaultId: "vault-a",
      status: "running",
      pending: 1,
      running: 0,
    });
  });

  it("dispose cancels a pending debounce so flush does not run after teardown (#817)", async () => {
    vi.useFakeTimers();
    const store = createDerivedCatchUpStatusStore();
    const stats = vi.fn(async () => emptyStats);
    const refresher = createDerivedCatchUpStatusRefresher({
      store,
      stats,
      getActiveVaultId: () => "vault-a",
    });

    void refresher.refresh();
    refresher.dispose();
    await vi.advanceTimersByTimeAsync(500);

    expect(stats).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
