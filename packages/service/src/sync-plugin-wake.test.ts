import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyncPluginWakeController } from "./sync-plugin-wake.js";

describe("createSyncPluginWakeController (#31)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifyVaultReady calls syncNow for onVaultReady plugins", async () => {
    const syncNow = vi.fn(async () => undefined);
    const wake = createSyncPluginWakeController({ syncNow });
    wake.register("a", { onVaultReady: true });
    wake.register("b", { onVaultReady: false });

    await wake.notifyVaultReady();

    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(syncNow).toHaveBeenCalledWith("a");
    wake.dispose();
  });

  it("notifyVaultReady is no-op with no registrations", async () => {
    const syncNow = vi.fn(async () => undefined);
    const wake = createSyncPluginWakeController({ syncNow });
    await wake.notifyVaultReady();
    expect(syncNow).not.toHaveBeenCalled();
    wake.dispose();
  });

  it("error in one plugin does not block the next", async () => {
    const syncNow = vi.fn(async (pluginId: string) => {
      if (pluginId === "bad") {
        throw new Error("boom");
      }
    });
    const logError = vi.fn();
    const wake = createSyncPluginWakeController({ syncNow, logError });
    wake.register("bad", { onVaultReady: true });
    wake.register("good", { onVaultReady: true });

    await wake.notifyVaultReady();

    expect(syncNow).toHaveBeenCalledWith("bad");
    expect(syncNow).toHaveBeenCalledWith("good");
    expect(logError).toHaveBeenCalledWith("bad", expect.any(Error));
    wake.dispose();
  });

  it("single-flight: concurrent wakes share one syncNow", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const syncNow = vi.fn(async () => {
      await gate;
    });
    const wake = createSyncPluginWakeController({ syncNow });
    wake.register("a", { onVaultReady: true });

    const first = wake.notifyVaultReady();
    const second = wake.notifyVaultReady();
    // First notify started sync; second should attach to inflight.
    await Promise.resolve();
    expect(syncNow).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(syncNow).toHaveBeenCalledTimes(1);
    wake.dispose();
  });

  it("intervalMs triggers repeated syncNow", async () => {
    vi.useFakeTimers();
    const syncNow = vi.fn(async () => undefined);
    const wake = createSyncPluginWakeController({ syncNow });
    wake.register("a", { onVaultReady: false, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(syncNow).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(syncNow).toHaveBeenCalledTimes(2);
    wake.dispose();
  });

  it("dispose stops timers", async () => {
    vi.useFakeTimers();
    const syncNow = vi.fn(async () => undefined);
    const wake = createSyncPluginWakeController({ syncNow });
    wake.register("a", { onVaultReady: false, intervalMs: 1000 });
    wake.dispose();

    await vi.advanceTimersByTimeAsync(5000);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it("register rejects invalid intervalMs", () => {
    const wake = createSyncPluginWakeController({
      syncNow: async () => undefined,
    });
    expect(() =>
      wake.register("a", { onVaultReady: false, intervalMs: 0 }),
    ).toThrow(/intervalMs/);
    wake.dispose();
  });
});
