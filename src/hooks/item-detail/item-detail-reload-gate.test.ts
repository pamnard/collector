import { describe, expect, it, vi } from "vitest";
import {
  createItemDetailReloadGate,
  runItemDetailVaultReload,
} from "./item-detail-reload-gate";

describe("item detail vault reload after delete", () => {
  it("does not report Item not found after delete when vaultRevision reload fails", async () => {
    const gate = createItemDetailReloadGate();
    gate.markLeavingAfterDelete();

    const onError = vi.fn();
    const started = await runItemDetailVaultReload({
      gate,
      isCancelled: () => false,
      reload: async () => {
        throw new Error("Item not found: Inbox/114cdf05-78c5-5832-b84b-472a302563c8.md");
      },
      onError,
    });

    expect(started).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("ignores late failure when reload started before delete completed", async () => {
    const gate = createItemDetailReloadGate();
    let resolveReload!: () => void;
    const reloadStarted = new Promise<void>((resolve) => {
      resolveReload = resolve;
    });

    const onError = vi.fn();
    const pending = runItemDetailVaultReload({
      gate,
      isCancelled: () => false,
      reload: async () => {
        resolveReload();
        await Promise.resolve();
        throw new Error("Item not found: Inbox/gone.md");
      },
      onError,
    });

    await reloadStarted;
    gate.markLeavingAfterDelete();
    await pending;

    expect(onError).not.toHaveBeenCalled();
  });

  it("still reports Item not found for a normal missing id load", async () => {
    const gate = createItemDetailReloadGate();
    const onError = vi.fn();
    const message = "Item not found: Inbox/missing.md";

    const started = await runItemDetailVaultReload({
      gate,
      isCancelled: () => false,
      reload: async () => {
        throw new Error(message);
      },
      onError,
    });

    expect(started).toBe(true);
    expect(onError).toHaveBeenCalledWith(message);
  });

  it("does not report when the effect was cancelled", async () => {
    const gate = createItemDetailReloadGate();
    const onError = vi.fn();

    await runItemDetailVaultReload({
      gate,
      isCancelled: () => true,
      reload: async () => {
        throw new Error("Item not found: Inbox/stale.md");
      },
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it("clears leaving flag so a later load can report errors again", async () => {
    const gate = createItemDetailReloadGate();
    gate.markLeavingAfterDelete();
    gate.clearLeavingAfterDelete();

    const onError = vi.fn();
    await runItemDetailVaultReload({
      gate,
      isCancelled: () => false,
      reload: async () => {
        throw new Error("Item not found: Inbox/again.md");
      },
      onError,
    });

    expect(onError).toHaveBeenCalledWith("Item not found: Inbox/again.md");
  });
});
