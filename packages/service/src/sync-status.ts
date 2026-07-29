/**
 * Vault index sync status subscribe/get facade (#150).
 * Full sync engine stays in the host app (later S tickets).
 */

import type { Subscription, VaultIndexSyncStatus } from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";

export type { VaultIndexSyncStatus } from "@collector/api";

export interface VaultIndexSyncStatusStore {
  subscribe(onUpdate: (status: VaultIndexSyncStatus) => void): Subscription;
  get(): VaultIndexSyncStatus;
  set(next: VaultIndexSyncStatus): void;
}

const IDLE_STATUS: VaultIndexSyncStatus = {
  vaultId: null,
  status: "idle",
  progress: null,
  metadataReady: true,
  ftsReady: true,
};

export function createVaultIndexSyncStatusStore(
  initial: VaultIndexSyncStatus = IDLE_STATUS,
): VaultIndexSyncStatusStore {
  let status: VaultIndexSyncStatus = { ...initial };
  const listeners = new Set<(status: VaultIndexSyncStatus) => void>();

  return {
    subscribe(onUpdate) {
      onUpdate(status);
      listeners.add(onUpdate);
      return subscriptionFromTeardown(() => {
        listeners.delete(onUpdate);
      });
    },
    get() {
      return status;
    },
    set(next) {
      status = next;
      for (const listener of listeners) {
        listener(next);
      }
    },
  };
}
