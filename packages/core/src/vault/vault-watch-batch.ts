export interface VaultWatchBatch {
  itemIds: string[];
  folderPaths: string[];
}

export interface VaultWatchBatcher {
  enqueueItem: (itemId: string) => void;
  enqueueFolder: (folderPath: string) => void;
  flush: () => void;
  dispose: () => void;
}

/** Dedupe strings while preserving first-seen order. */
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
  onFlush: (batch: VaultWatchBatch) => void | Promise<void>;
}): VaultWatchBatcher {
  const pendingItems = new Set<string>();
  const pendingFolders = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const runFlush = () => {
    if (disposed || (pendingItems.size === 0 && pendingFolders.size === 0)) {
      return;
    }
    // Sets already dedupe; iteration order is insertion order.
    const itemIds = [...pendingItems];
    const folderPaths = [...pendingFolders];
    pendingItems.clear();
    pendingFolders.clear();
    void options.onFlush({ itemIds, folderPaths });
  };

  const schedule = () => {
    if (disposed) {
      return;
    }
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      runFlush();
    }, options.debounceMs);
  };

  return {
    enqueueItem(itemId) {
      if (disposed) {
        return;
      }
      pendingItems.add(itemId);
      schedule();
    },
    enqueueFolder(folderPath) {
      if (disposed) {
        return;
      }
      pendingFolders.add(folderPath);
      schedule();
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
      pendingItems.clear();
      pendingFolders.clear();
    },
  };
}
