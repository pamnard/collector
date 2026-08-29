import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncPluginPullJobType } from "@collector/shared";
import { enqueueSyncPluginPull } from "./jobs/handlers/sync-plugin-pull.js";
import { createJobQueue, type JobQueue } from "./jobs/job-queue.js";
import { createJobRegistry } from "./jobs/job-registry.js";
import { createSyncPluginWakeController } from "./sync-plugin-wake.js";

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

describe("createSyncPluginWakeController (#31)", () => {
  let dataDir = "";
  const queues: JobQueue[] = [];
  const wakes: Array<ReturnType<typeof createSyncPluginWakeController>> = [];

  afterEach(async () => {
    for (const wake of wakes.splice(0)) {
      wake.dispose();
    }
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function openQueue(): Promise<JobQueue> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-sync-plugin-wake-"));
    const registry = createJobRegistry([syncPluginPullJobType]);
    registry.register(syncPluginPullJobType, async () => ({ status: "ok" }));
    const queue = await createJobQueue({
      dbPath: join(dataDir, "jobs.db"),
      registry,
    });
    queues.push(queue);
    return queue;
  }

  function bindWake(
    queue: JobQueue,
    options?: {
      onEnqueueFailure?: (pluginId: string, error: unknown) => void;
      setIntervalFn?: typeof setInterval;
      clearIntervalFn?: typeof clearInterval;
      enqueueOverride?: (pluginId: string) => Promise<unknown>;
    },
  ) {
    const wake = createSyncPluginWakeController({
      enqueueSyncPluginPull:
        options?.enqueueOverride ??
        ((pluginId) => enqueueSyncPluginPull(queue, { pluginId })),
      onEnqueueFailure: options?.onEnqueueFailure ?? (() => undefined),
      setIntervalFn: options?.setIntervalFn,
      clearIntervalFn: options?.clearIntervalFn,
    });
    wakes.push(wake);
    return wake;
  }

  async function expectPendingPull(
    queue: JobQueue,
    pluginId: string,
  ): Promise<void> {
    const job = await queue.findByIdempotencyKey(`syncPluginPull:${pluginId}`);
    expect(job).not.toBeNull();
    expect(job!.type).toBe(syncPluginPullJobType.id);
    expect(job!.status).toBe("pending");
    expect(JSON.parse(job!.payload_json)).toEqual({ pluginId });
  }

  it("notifyVaultReady leaves syncPluginPull pending in jobs.db for onVaultReady plugins", async () => {
    const queue = await openQueue();
    const wake = bindWake(queue);
    wake.register("telegram", { onVaultReady: true });
    wake.register("reddit", { onVaultReady: false });

    await wake.notifyVaultReady();
    await waitFor(async () => (await queue.stats()).pending === 1);

    const stats = await queue.stats();
    expect(stats.pending).toBe(1);
    expect(stats.byType.syncPluginPull).toMatchObject({
      pending: 1,
      running: 0,
      succeeded: 0,
      failed: 0,
    });
    await expectPendingPull(queue, "telegram");
    expect(
      await queue.findByIdempotencyKey("syncPluginPull:reddit"),
    ).toBeNull();
  });

  it("notifyVaultReady returns before enqueue finishes (isolation)", async () => {
    const queue = await openQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wake = bindWake(queue, {
      enqueueOverride: async (pluginId) => {
        await gate;
        return enqueueSyncPluginPull(queue, { pluginId });
      },
    });
    wake.register("telegram", { onVaultReady: true });

    const ready = wake.notifyVaultReady();
    await expect(ready).resolves.toBeUndefined();
    expect((await queue.stats()).pending).toBe(0);

    release();
    await waitFor(async () => (await queue.stats()).pending === 1);
    await expectPendingPull(queue, "telegram");
  });

  it("notifyVaultReady is no-op with no registrations", async () => {
    const queue = await openQueue();
    const wake = bindWake(queue);

    await wake.notifyVaultReady();

    expect(await queue.stats()).toMatchObject({
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    });
    expect((await queue.stats()).byType.syncPluginPull).toBeUndefined();
  });

  it("error in one plugin does not block the next jobs.db enqueue", async () => {
    const queue = await openQueue();
    const failures: Array<{ pluginId: string; error: unknown }> = [];
    const wake = bindWake(queue, {
      onEnqueueFailure: (pluginId, error) => {
        failures.push({ pluginId, error });
      },
      enqueueOverride: async (pluginId) => {
        if (pluginId === "bad") {
          throw new Error("boom");
        }
        return enqueueSyncPluginPull(queue, { pluginId });
      },
    });
    wake.register("bad", { onVaultReady: true });
    wake.register("good", { onVaultReady: true });

    await wake.notifyVaultReady();
    await waitFor(async () => (await queue.stats()).pending === 1);
    await waitFor(async () => failures.length === 1);

    expect(failures[0]!.pluginId).toBe("bad");
    expect(failures[0]!.error).toBeInstanceOf(Error);
    await expectPendingPull(queue, "good");
    expect(await queue.findByIdempotencyKey("syncPluginPull:bad")).toBeNull();
  });

  it("repeated vault-ready wakes coalesce to one pending syncPluginPull row", async () => {
    const queue = await openQueue();
    const wake = bindWake(queue);
    wake.register("telegram", { onVaultReady: true });

    await wake.notifyVaultReady();
    await waitFor(async () => (await queue.stats()).pending === 1);
    const first = await queue.findByIdempotencyKey("syncPluginPull:telegram");
    expect(first).not.toBeNull();

    await wake.notifyVaultReady();
    await waitFor(async () => {
      const job = await queue.findByIdempotencyKey("syncPluginPull:telegram");
      return job !== null && (await queue.stats()).pending === 1;
    });

    expect((await queue.stats()).pending).toBe(1);
    expect((await queue.stats()).byType.syncPluginPull).toMatchObject({
      pending: 1,
    });
    const second = await queue.findByIdempotencyKey("syncPluginPull:telegram");
    expect(second!.id).toBe(first!.id);
    await expectPendingPull(queue, "telegram");
  });

  function manualIntervalClock(): {
    setIntervalFn: typeof setInterval;
    clearIntervalFn: typeof clearInterval;
    fireAll: () => void;
    activeCount: () => number;
  } {
    let nextId = 1;
    const active = new Map<number, () => void>();
    return {
      setIntervalFn: ((handler: TimerHandler) => {
        const id = nextId++;
        active.set(id, () => {
          if (typeof handler === "function") {
            handler();
          }
        });
        return id as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
      clearIntervalFn: ((id: ReturnType<typeof setInterval>) => {
        active.delete(id as unknown as number);
      }) as typeof clearInterval,
      fireAll: () => {
        for (const tick of [...active.values()]) {
          tick();
        }
      },
      activeCount: () => active.size,
    };
  }

  it("intervalMs leaves syncPluginPull pending in jobs.db on each tick", async () => {
    const queue = await openQueue();
    const clock = manualIntervalClock();
    const wake = bindWake(queue, {
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });
    wake.register("telegram", { onVaultReady: false, intervalMs: 1000 });
    expect(clock.activeCount()).toBe(1);

    clock.fireAll();
    await waitFor(async () => (await queue.stats()).pending === 1);
    await expectPendingPull(queue, "telegram");

    // Coalesce while still pending — second tick must not add another row.
    clock.fireAll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await queue.stats()).pending).toBe(1);
  });

  it("dispose stops interval ticks from enqueueing into jobs.db", async () => {
    const queue = await openQueue();
    const clock = manualIntervalClock();
    const wake = bindWake(queue, {
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });
    wake.register("telegram", { onVaultReady: false, intervalMs: 1000 });
    expect(clock.activeCount()).toBe(1);
    wake.dispose();
    expect(clock.activeCount()).toBe(0);

    clock.fireAll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await queue.stats()).pending).toBe(0);
  });

  it("register rejects invalid intervalMs", async () => {
    const queue = await openQueue();
    const wake = bindWake(queue);
    expect(() =>
      wake.register("telegram", { onVaultReady: false, intervalMs: 0 }),
    ).toThrow(/intervalMs/);
  });
});
