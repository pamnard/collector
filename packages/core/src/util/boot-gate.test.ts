import { describe, expect, it } from "vitest";
import { createTwoPhaseBootGate } from "./boot-gate.js";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createTwoPhaseBootGate", () => {
  it("resolves open before health completes", async () => {
    const openGate = deferred();
    const healthGate = deferred();
    let healthStarted = false;

    const boot = createTwoPhaseBootGate({
      open: async () => {
        await openGate.promise;
      },
      health: async () => {
        healthStarted = true;
        await healthGate.promise;
      },
    });

    const openDone = boot.open();
    openGate.resolve();
    await openDone;
    expect(boot.isOpen()).toBe(true);
    expect(boot.isHealthy()).toBe(false);
    expect(healthStarted).toBe(false);

    const healthyDone = boot.ensureHealthy();
    await Promise.resolve();
    expect(healthStarted).toBe(true);
    expect(boot.isHealthy()).toBe(false);

    healthGate.resolve();
    await healthyDone;
    expect(boot.isHealthy()).toBe(true);
  });

  it("ensureHealthy waits for in-flight health (single-flight)", async () => {
    const healthGate = deferred();
    let healthCalls = 0;

    const boot = createTwoPhaseBootGate({
      open: async () => {},
      health: async () => {
        healthCalls += 1;
        await healthGate.promise;
      },
    });

    await boot.open();

    const a = boot.ensureHealthy();
    const b = boot.ensureHealthy();
    await Promise.resolve();
    expect(healthCalls).toBe(1);

    healthGate.resolve();
    await Promise.all([a, b]);
    expect(healthCalls).toBe(1);
    expect(boot.isHealthy()).toBe(true);
  });

  it("propagates fatal open errors to later callers", async () => {
    const boot = createTwoPhaseBootGate({
      open: async () => {
        throw new Error("open failed");
      },
      health: async () => {},
    });

    await expect(boot.open()).rejects.toThrow("open failed");
    await expect(boot.ensureHealthy()).rejects.toThrow("open failed");
  });

  it("propagates fatal health errors to later callers", async () => {
    const boot = createTwoPhaseBootGate({
      open: async () => {},
      health: async () => {
        throw new Error("health failed");
      },
    });

    await boot.open();
    await expect(boot.ensureHealthy()).rejects.toThrow("health failed");
    await expect(boot.ensureHealthy()).rejects.toThrow("health failed");
  });
});
