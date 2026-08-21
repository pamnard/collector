/**
 * Facade-adjacent domain shapes that today also appear in `@collector/core` / app.
 * Declared here so `@collector/api` stays free of core runtime.
 */

import type {
  ItemFile,
  MediaFileMeta,
  SourceRef,
  SourceType,
  Tag,
} from "@collector/shared";

export type NavFilter =
  | "all"
  | { type: "tag"; tagId: string }
  | { type: "folder"; folderPath: string };

export interface TagWithCount extends Tag {
  item_count: number;
}

export interface FolderTreeNode {
  name: string;
  path: string;
  item_count: number;
  children: FolderTreeNode[];
}

export interface MediaWithPath extends MediaFileMeta {
  absolute_path: string;
}

export type IndexSyncPhase = "metadata" | "content";

export interface IndexSyncProgress {
  phase: IndexSyncPhase;
  processed: number;
  total: number;
  skipped: number;
  patched: number;
  indexed: number;
  contentIndexed: number;
  removed: number;
}

export interface CreateItemInput {
  title: string;
  description?: string;
  url?: string | null;
  content_type: ItemFile["content_type"];
  content?: string | null;
  folder_path?: string;
  source_type?: SourceType;
  /** Optional plugin provenance (#28); written via upsertItem sourceRef. */
  sourceRef?: SourceRef;
}

/** One file from a list/folder drop (relativePath includes name within the drop tree). */
export interface ImportDroppedFileInput extends BinaryPayload {
  relativePath: string;
}

export interface ImportDroppedFilesInput {
  /** Target list folder; omit/empty → Inbox via createItem. */
  folder_path?: string;
  files: ImportDroppedFileInput[];
}

export interface ImportDroppedFilesResult {
  createdIds: string[];
}

/** Host-path folder bulk import (#747). */
export interface ImportFolderInput {
  /** Absolute path on the host filesystem. */
  sourceDirAbs: string;
  /** Target vault folder; omit/empty → Inbox via createItem. */
  targetFolderPath?: string;
}

export interface ImportFolderFailure {
  relativePath: string;
  error: string;
}

export type ImportFolderResultStatus = "ok" | "partial" | "failed";

export interface ImportFolderResult {
  createdIds: string[];
  skippedIds: string[];
  /** Sample of failures (capped); see {@link failed} for the true count. */
  failures: ImportFolderFailure[];
  created: number;
  skipped: number;
  /** Total failure count (not capped by the failures sample). */
  failed: number;
  /** ok when failed===0; partial when some succeeded/skipped with failures; failed when only failures. */
  status: ImportFolderResultStatus;
}

export type ImportFolderJobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ImportFolderJobSnapshot {
  jobId: string;
  /**
   * Job-row lifecycle status from the host queue.
   * Note the dual-status contract: the row may be `succeeded` while
   * {@link result}.status is `partial` or `failed` (per-file import errors
   * that did not abort the job). Treat `status === "succeeded"` as
   * "handler finished", and inspect `result` for import outcome.
   */
  status: ImportFolderJobStatus;
  result: ImportFolderResult | null;
  error: string | null;
}

export interface UpdateItemInput {
  title?: string;
  description?: string;
  url?: string | null;
  content_type?: ItemFile["content_type"];
  content?: string | null;
  /** Tag names as in the vault .md frontmatter; missing names are created. */
  tags?: string[];
  folder_path?: string;
  /** Foreign frontmatter keys (open map). */
  properties?: Record<string, unknown>;
}

/** Transport-honest binary file payload (#364). */
export interface BinaryPayload {
  name: string;
  bytes: Uint8Array;
}

export type AttachMediaFileInput = BinaryPayload;
