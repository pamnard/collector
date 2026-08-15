import type { Subscription } from "@collector/api";

export type VaultPresentationIndex = {
  subscribeVaultPresentationChanged: (onUpdate: () => void) => Subscription;
};

/**
 * Subscribe to vault presentation changes and bump revision.
 * Isolated from React / CollectorService singleton for unit tests.
 */
export function subscribeVaultPresentationRevision(
  index: VaultPresentationIndex,
  onBump: () => void,
): () => void {
  return index.subscribeVaultPresentationChanged(onBump).unsubscribe;
}
