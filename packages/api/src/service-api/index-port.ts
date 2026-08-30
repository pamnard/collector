import type { IndexSyncProgress } from "../domain.js";
import type { Subscription } from "./shared.js";

export interface VaultIndexSyncStatus {
  vaultId: string | null;
  status: "idle" | "rebuilding" | "running" | "done";
  progress: IndexSyncProgress | null;
  metadataReady: boolean;
  ftsReady: boolean;
}

/** Post-save derived index catch-up via `itemDerivedRefresh` jobs (#767). */
export interface DerivedCatchUpStatus {
  vaultId: string | null;
  status: "idle" | "running";
  pending: number;
  running: number;
}

/**
 * Vault presentation change kind (#756).
 * Mirrored from `@collector/service` vault-presentation-changed contract.
 */
export type VaultPresentationChangeKind =
  | "itemCreated"
  | "itemUpserted"
  | "itemDeleted"
  | "itemMoved"
  | "itemCoverChanged"
  | "folderChanged"
  /** Post-save derived pipeline finished for item (#765 / #769; emit from #766/#768). */
  | "itemDerivedComplete";

/**
 * Richer vaultPresentationChanged payload (#756).
 * Host writers emit scoped events; UI applies incremental updates by relevance.
 */
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

/** Index sync status port (#361). */
export interface IndexPort {
  subscribeVaultIndexSyncStatus(
    onUpdate: (status: VaultIndexSyncStatus) => void,
  ): Subscription;
  getVaultIndexSyncStatus(): VaultIndexSyncStatus;
  subscribeDerivedCatchUpStatus(
    onUpdate: (status: DerivedCatchUpStatus) => void,
  ): Subscription;
  getDerivedCatchUpStatus(): DerivedCatchUpStatus;
  /**
   * Fires after successful vault presentation writes (item/cover/move/folder) (#623 / #756).
   * UI applies scoped live updates; writer path is source-agnostic.
   */
  subscribeVaultPresentationChanged(
    onUpdate: (payload: VaultPresentationChangedPayload) => void,
  ): Subscription;
}
