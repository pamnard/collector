/** In-memory mailbox for job handlers that must return a value to an awaiter. */

export type JobResultMailboxOptions = {
  /**
   * When set, entries are dropped after this many ms so peek-only consumers
   * (e.g. importFolder CLI polls) cannot grow the map unbounded.
   */
  ttlMs?: number;
};

export function createJobResultMailbox<T>(
  options: JobResultMailboxOptions = {},
) {
  const byJobId = new Map<string, T>();
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const ttlMs = options.ttlMs;

  function clearExpiry(jobId: string): void {
    const timer = expiryTimers.get(jobId);
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    expiryTimers.delete(jobId);
  }

  function scheduleExpiry(jobId: string): void {
    if (ttlMs === undefined) {
      return;
    }
    clearExpiry(jobId);
    const timer = setTimeout(() => {
      expiryTimers.delete(jobId);
      byJobId.delete(jobId);
    }, ttlMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    expiryTimers.set(jobId, timer);
  }

  return {
    set(jobId: string, value: T): void {
      byJobId.set(jobId, value);
      scheduleExpiry(jobId);
    },
    peek(jobId: string): T | null {
      return byJobId.get(jobId) ?? null;
    },
    take(jobId: string): T | null {
      clearExpiry(jobId);
      const value = byJobId.get(jobId) ?? null;
      byJobId.delete(jobId);
      return value;
    },
  };
}
