import { describe, expect, it, vi } from "vitest";
import { createVaultIndexSyncStatusStore } from "./sync-status.js";

describe("createVaultIndexSyncStatusStore", () => {
  it("notifies subscribers on set and returns current via get", () => {
    const store = createVaultIndexSyncStatusStore();
    const seen: unknown[] = [];
    const unsub = store.subscribe((status) => {
      seen.push(status.status);
    });

    expect(store.get().status).toBe("idle");
    expect(seen).toEqual(["idle"]);

    store.set({
      vaultId: "v1",
      status: "running",
      progress: null,
      metadataReady: false,
      ftsReady: false,
    });

    expect(store.get().status).toBe("running");
    expect(seen).toEqual(["idle", "running"]);

    unsub();
    store.set({
      vaultId: "v1",
      status: "done",
      progress: null,
      metadataReady: true,
      ftsReady: true,
    });
    expect(seen).toEqual(["idle", "running"]);
  });
});
