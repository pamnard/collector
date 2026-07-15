export interface VaultWatchBatcher {
  enqueue: (itemId: string) => void;
  flush: () => void;
  dispose: () => void;
}

/** Dedupe item ids while preserving first-seen order. */
export function dedupeVaultWatchItemIds(itemIds: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const itemId of itemIds) {
    if (seen.has(itemId)) {
      continue;
    }
    seen.add(itemId);
    result.push(itemId);
  }
  return result;
}

export function createVaultWatchBatcher(options: {
  debounceMs: number;
  onFlush: (itemIds: string[]) => void | Promise<void>;
}): VaultWatchBatcher {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const runFlush = () => {
    if (disposed || pending.size === 0) {
      return;
    }
    const itemIds = dedupeVaultWatchItemIds([...pending]);
    pending.clear();
    void options.onFlush(itemIds);
  };

  return {
    enqueue(itemId) {
      if (disposed) {
        return;
      }
      pending.add(itemId);
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        runFlush();
      }, options.debounceMs);
    },
    flush() {
      if (disposed) {
        return;
      }
      clearTimer();
      runFlush();
    },
    dispose() {
      disposed = true;
      clearTimer();
      pending.clear();
    },
  };
}
