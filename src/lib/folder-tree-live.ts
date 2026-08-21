/**
 * Non-React fan-out for incremental folder-tree live updates (#756).
 * Keeps subscribeFolderTree identity stable (no vaultRevision remount).
 */

export type FolderTreeLiveListener = {
  onDeltas: (deltas: Map<string, number>) => void;
  onRecount: () => void;
};

const listeners = new Set<FolderTreeLiveListener>();

export function subscribeFolderTreeLive(
  listener: FolderTreeLiveListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitFolderTreeCountDeltas(deltas: Map<string, number>): void {
  if (deltas.size === 0) {
    return;
  }
  for (const listener of listeners) {
    listener.onDeltas(deltas);
  }
}

export function emitFolderTreeRecount(): void {
  for (const listener of listeners) {
    listener.onRecount();
  }
}
