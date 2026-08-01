/**
 * Sync plugin contract (#28) — product connectors into vault import.
 * Wake/schedule policy is per-plugin (#31 = host hooks only).
 */

import type { ItemFile, SourceRef } from "@collector/shared";
import type { BinaryPayload } from "./domain.js";

/** Opaque per-plugin cursor (e.g. Telegram getUpdates offset). */
export type SyncCursor = string;

export interface NormalizedSyncItem {
  /** Id within this pull/ack cycle (e.g. chat_id:message_id). Not required on the vault item. */
  remoteId: string;
  title: string;
  /** Required — handoff must not invent content_type. */
  content_type: ItemFile["content_type"];
  body?: string;
  url?: string | null;
  /** Destination list folder; omit/empty → inbox via createItem. */
  folder_path?: string;
  /**
   * Optional vault SourceRef. Telegram Path C (#415/#436): omit —
   * dedup is plugin ledgers (`imported` / `awaiting_delete`), not item ids.
   */
  sourceRef?: SourceRef;
  media?: BinaryPayload[];
}

export interface PullResult {
  items: NormalizedSyncItem[];
  /** Next cursor to store; null = unchanged / not applicable. */
  nextCursor: SyncCursor | null;
  /** Non-fatal skip reasons (e.g. oversized Telegram file). */
  warnings?: string[];
}

export interface SyncPlugin {
  readonly id: string;

  /**
   * Optional readiness check (e.g. getMe). Not a substitute for #30 storage.
   * Secrets: CredentialsPort.getCredential in the host process.
   */
  authenticate?(): Promise<void>;

  /**
   * Fetch a batch since `cursor`. Must not write vault items — return
   * normalized items only.
   */
  pull(cursor: SyncCursor | null): Promise<PullResult>;

  /**
   * Persist “already imported” before remote release (Telegram: ledger on disk).
   * Called immediately after each successful vault create.
   */
  markImported?(remoteIds: string[]): Promise<void>;

  /**
   * After core successfully imported `remoteIds`, release remote queue
   * (Telegram: deleteMessage). Retry-safe. Omit if the source has no
   * post-import remote side effect.
   */
  ack?(remoteIds: string[]): Promise<void>;

  /**
   * Drop durable imported marks after the sync cursor was persisted
   * (Telegram: clear `imported` once offset advanced).
   */
  clearImported?(remoteIds: string[]): Promise<void>;
}
