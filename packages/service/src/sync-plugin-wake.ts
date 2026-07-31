/**
 * Sync plugin wake controller (#31).
 *
 * Host lifecycle hooks that call #29 `syncNow` for plugins that opt in.
 * Not a settings surface — wake policy is registered per plugin at build time.
 */

export interface SyncPluginWakePolicy {
  /** After vault session is ready / switched — call syncNow. */
  onVaultReady: boolean;
  /** Optional repeating wake; omit = no timer. */
  intervalMs?: number;
}

export interface SyncPluginWakeControllerDeps {
  syncNow: (pluginId: string) => Promise<unknown>;
  /** Defaults to console.error with pluginId context. */
  logError?: (pluginId: string, error: unknown) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface SyncPluginWakeController {
  register(pluginId: string, policy: SyncPluginWakePolicy): void;
  /** Host signals vault ready; runs onVaultReady plugins. */
  notifyVaultReady(): Promise<void>;
  dispose(): void;
}

function defaultLogError(pluginId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sync-plugin-wake] ${pluginId}: ${message}`);
}

export function createSyncPluginWakeController(
  deps: SyncPluginWakeControllerDeps,
): SyncPluginWakeController {
  const policies = new Map<string, SyncPluginWakePolicy>();
  const inflight = new Map<string, Promise<void>>();
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  const logError = deps.logError ?? defaultLogError;
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  let disposed = false;

  const runSync = (pluginId: string): Promise<void> => {
    const existing = inflight.get(pluginId);
    if (existing) {
      return existing;
    }
    const run = (async () => {
      try {
        await deps.syncNow(pluginId);
      } catch (error) {
        logError(pluginId, error);
      } finally {
        inflight.delete(pluginId);
      }
    })();
    inflight.set(pluginId, run);
    return run;
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
        void runSync(pluginId);
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
      // Re-arm intervals on vault ready / switch (fresh session).
      armIntervals();
      // Fire-and-forget (#415 isolation): never block vault switch / host boot
      // on plugin network I/O. Errors stay inside runSync → logError.
      for (const [pluginId, policy] of policies) {
        if (!policy.onVaultReady) {
          continue;
        }
        void runSync(pluginId);
      }
    },

    dispose() {
      disposed = true;
      clearTimers();
      policies.clear();
      inflight.clear();
    },
  };
}
