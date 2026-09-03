/**
 * Non-React fan-out for sidebar tag-list live refreshes (#950).
 * Mirrors folder-tree-live so hooks can refetch without vaultRevision remounts.
 */

const listeners = new Set<() => void>();

export function subscribeTagListLive(onRefresh: () => void): () => void {
  listeners.add(onRefresh);
  return () => {
    listeners.delete(onRefresh);
  };
}

export function emitTagListRefresh(): void {
  for (const listener of listeners) {
    listener();
  }
}
