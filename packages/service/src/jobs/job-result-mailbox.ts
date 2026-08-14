/** In-memory mailbox for job handlers that must return a value to an awaiter. */

export function createJobResultMailbox<T>() {
  const byJobId = new Map<string, T>();
  return {
    set(jobId: string, value: T): void {
      byJobId.set(jobId, value);
    },
    take(jobId: string): T | null {
      const value = byJobId.get(jobId) ?? null;
      byJobId.delete(jobId);
      return value;
    },
  };
}
