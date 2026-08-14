/**
 * Sync plugin wake controller (#31 / #635).
 *
 * Host lifecycle hooks that enqueue syncPluginPull jobs for plugins that opt in.
 * Not a settings surface — wake policy is registered per plugin at build time.
 * Serialization / coalesce lives in the job queue + registry.
 */

export interface SyncPluginWakePolicy {
  /** After vault session is ready / switched — enqueue sync. */
  onVaultReady: boolean;
  /** Optional repeating wake; omit = no timer. */
  intervalMs?: number;
}

export interface SyncPluginWakeControllerDeps {
  enqueueSyncPluginPull: (pluginId: string) => Promise<unknown>;
  /** Surface enqueue failures (host wires AlertStack via reportEnqueueFailure). */
  onEnqueueFailure: (pluginId: string, error: unknown) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface SyncPluginWakeController {
  register(pluginId: string, policy: SyncPluginWakePolicy): void;
  /** Host signals vault ready; enqueues onVaultReady plugins. */
  notifyVaultReady(): Promise<void>;
  dispose(): void;
}

export function createSyncPluginWakeController(
  deps: SyncPluginWakeControllerDeps,
): SyncPluginWakeController {
  const policies = new Map<string, SyncPluginWakePolicy>();
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  let disposed = false;

  const runEnqueue = (pluginId: string): void => {
    void (async () => {
      try {
        await deps.enqueueSyncPluginPull(pluginId);
      } catch (error) {
        deps.onEnqueueFailure(pluginId, error);
      }
    })();
  };

  const clearTimers = (): void => {
    for (const timer of timers.values()) {
      clearIntervalFn(timer);
    }
    timers.clear();
  };

  const armIntervals = (): void => {
    clearTimers();
    if (disposed) {
      return;
    }
    for (const [pluginId, policy] of policies) {
      if (policy.intervalMs === undefined) {
        continue;
      }
      if (
        typeof policy.intervalMs !== "number" ||
        !Number.isFinite(policy.intervalMs) ||
        policy.intervalMs <= 0
      ) {
        throw new Error(
          `sync-plugin-wake: invalid intervalMs for ${pluginId}`,
        );
      }
      const timer = setIntervalFn(() => {
        runEnqueue(pluginId);
      }, policy.intervalMs);
      timers.set(pluginId, timer);
    }
  };

  return {
    register(pluginId, policy) {
      if (disposed) {
        throw new Error("sync-plugin-wake: disposed");
      }
      if (!pluginId.trim()) {
        throw new Error("sync-plugin-wake: pluginId required");
      }
      if (policy.intervalMs !== undefined) {
        if (
          typeof policy.intervalMs !== "number" ||
          !Number.isFinite(policy.intervalMs) ||
          policy.intervalMs <= 0
        ) {
          throw new Error(
            `sync-plugin-wake: invalid intervalMs for ${pluginId}`,
          );
        }
      }
      policies.set(pluginId, { ...policy });
      armIntervals();
    },

    async notifyVaultReady() {
      if (disposed) {
        return;
      }
      armIntervals();
      for (const [pluginId, policy] of policies) {
        if (!policy.onVaultReady) {
          continue;
        }
        runEnqueue(pluginId);
      }
    },

    dispose() {
      disposed = true;
      clearTimers();
      policies.clear();
    },
  };
}
