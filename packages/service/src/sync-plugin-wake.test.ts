import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyncPluginWakeController } from "./sync-plugin-wake.js";

describe("createSyncPluginWakeController (#31)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifyVaultReady enqueues onVaultReady plugins", async () => {
    const enqueueSyncPluginPull = vi.fn(async () => undefined);
    const wake = createSyncPluginWakeController({ enqueueSyncPluginPull });
    wake.register("a", { onVaultReady: true });
    wake.register("b", { onVaultReady: false });

    await wake.notifyVaultReady();
    await Promise.resolve();

    expect(enqueueSyncPluginPull).toHaveBeenCalledTimes(1);
    expect(enqueueSyncPluginPull).toHaveBeenCalledWith("a");
    wake.dispose();
  });

  it("notifyVaultReady returns before enqueue finishes (isolation)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enqueueSyncPluginPull = vi.fn(async () => {
      await gate;
    });
    const wake = createSyncPluginWakeController({ enqueueSyncPluginPull });
    wake.register("a", { onVaultReady: true });

    const ready = wake.notifyVaultReady();
    await expect(ready).resolves.toBeUndefined();
    expect(enqueueSyncPluginPull).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    wake.dispose();
  });

  it("notifyVaultReady is no-op with no registrations", async () => {
    const enqueueSyncPluginPull = vi.fn(async () => undefined);
    const wake = createSyncPluginWakeController({ enqueueSyncPluginPull });
    await wake.notifyVaultReady();
    expect(enqueueSyncPluginPull).not.toHaveBeenCalled();
    wake.dispose();
  });

  it("error in one plugin does not block the next", async () => {
    const enqueueSyncPluginPull = vi.fn(async (pluginId: string) => {
      if (pluginId === "bad") {
        throw new Error("boom");
      }
    });
    const logError = vi.fn();
    const wake = createSyncPluginWakeController({
      enqueueSyncPluginPull,
      logError,
    });
    wake.register("bad", { onVaultReady: true });
    wake.register("good", { onVaultReady: true });

    await wake.notifyVaultReady();
    await vi.waitFor(() => {
      expect(enqueueSyncPluginPull).toHaveBeenCalledWith("bad");
      expect(enqueueSyncPluginPull).toHaveBeenCalledWith("good");
      expect(logError).toHaveBeenCalledWith("bad", expect.any(Error));
    });
    wake.dispose();
  });

  it("forwards every vault-ready wake to enqueue (queue dedupes)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enqueueSyncPluginPull = vi.fn(async () => {
      await gate;
    });
    const wake = createSyncPluginWakeController({ enqueueSyncPluginPull });
    wake.register("a", { onVaultReady: true });

    const first = wake.notifyVaultReady();
    const second = wake.notifyVaultReady();
    await Promise.all([first, second]);
    await Promise.resolve();
    expect(enqueueSyncPluginPull).toHaveBeenCalledTimes(2);
    release();
    await vi.waitFor(() =>
      expect(enqueueSyncPluginPull).toHaveBeenCalledTimes(2),
    );
    wake.dispose();
  });

  it("intervalMs repeatedly enqueues sync plugin pulls", async () => {
    vi.useFakeTimers();
    const enqueueSyncPluginPull = vi.fn(async () => undefined);
    const wake = createSyncPluginWakeController({ enqueueSyncPluginPull });
    wake.register("a", { onVaultReady: false, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(enqueueSyncPluginPull).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(enqueueSyncPluginPull).toHaveBeenCalledTimes(2);
    wake.dispose();
  });

  it("dispose stops timers", async () => {
    vi.useFakeTimers();
    const enqueueSyncPluginPull = vi.fn(async () => undefined);
    const wake = createSyncPluginWakeController({ enqueueSyncPluginPull });
    wake.register("a", { onVaultReady: false, intervalMs: 1000 });
    wake.dispose();

    await vi.advanceTimersByTimeAsync(5000);
    expect(enqueueSyncPluginPull).not.toHaveBeenCalled();
  });

  it("register rejects invalid intervalMs", () => {
    const wake = createSyncPluginWakeController({
      enqueueSyncPluginPull: async () => undefined,
    });
    expect(() =>
      wake.register("a", { onVaultReady: false, intervalMs: 0 }),
    ).toThrow(/intervalMs/);
    wake.dispose();
  });
});
