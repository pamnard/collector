import type { Subscription } from "@collector/api";

export type VaultPresentationIndex = {
  subscribeVaultPresentationChanged: (onUpdate: () => void) => Subscription;
};

/**
 * Window for coalescing vaultRevision bumps (#653).
 * Presentation-changed + explicit refreshVault after one delete land inside it;
 * MCP-only presentation bumps still apply (single call).
 */
export const VAULT_REVISION_BUMP_COALESCE_MS = 100;

/**
 * Leading-edge coalesce: first bump runs, further bumps inside windowMs are no-ops.
 * Avoids wipe+refetch storms when deleteItem both notifies presentation-changed
 * and call sites also call refreshVault.
 */
export function createCoalescedVaultRevisionBump(
  onBump: () => void,
  windowMs: number = VAULT_REVISION_BUMP_COALESCE_MS,
  now: () => number = () => Date.now(),
): () => void {
  let lastBumpAt = Number.NEGATIVE_INFINITY;
  return () => {
    const t = now();
    if (t - lastBumpAt < windowMs) {
      return;
    }
    lastBumpAt = t;
    onBump();
  };
}

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
