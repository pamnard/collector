/**
 * Vault presentation-changed fan-out (#623 / #756).
 * Writers notify after successful item/cover/move/folder mutations so open UI
 * sessions apply scoped live updates regardless of UI / MCP / CLI / jobs.
 */

import type { Subscription } from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";

export type VaultPresentationChangeKind =
  | "itemUpserted"
  | "itemDeleted"
  | "itemMoved"
  | "itemCoverChanged"
  | "folderChanged";

export type VaultPresentationChangedPayload = {
  vaultId: string;
  kind: VaultPresentationChangeKind;
  itemId?: string;
  /** Upsert / delete / cover — item’s folder. folderChanged — affected folder node. */
  folderPath?: string;
  /** Move: source folder. */
  fromFolderPath?: string;
  /** Move: destination folder. */
  toFolderPath?: string;
};

export interface VaultPresentationChangedStore {
  subscribe(
    onUpdate: (payload: VaultPresentationChangedPayload) => void,
  ): Subscription;
  notify(payload: VaultPresentationChangedPayload): void;
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
    notify(payload: VaultPresentationChangedPayload) {
      for (const listener of listeners) {
        listener(payload);
      }
    },
  };
}
