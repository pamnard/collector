/**
 * Vault presentation-changed fan-out (#623).
 * Writers notify after successful item/cover/move mutations so open UI sessions
 * invalidate presentation caches the same way regardless of UI / MCP / CLI.
 */

import type { Subscription } from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";

export type VaultPresentationChangedPayload = {
  vaultId: string;
};

export interface VaultPresentationChangedStore {
  subscribe(
    onUpdate: (payload: VaultPresentationChangedPayload) => void,
  ): Subscription;
  notify(vaultId: string): void;
}

export function createVaultPresentationChangedStore(): VaultPresentationChangedStore {
  const listeners = new Set<
    (payload: VaultPresentationChangedPayload) => void
  >();

  return {
    subscribe(onUpdate) {
      listeners.add(onUpdate);
      return subscriptionFromTeardown(() => {
        listeners.delete(onUpdate);
      });
    },
    notify(vaultId: string) {
      const payload: VaultPresentationChangedPayload = { vaultId };
      for (const listener of listeners) {
        listener(payload);
      }
    },
  };
}
