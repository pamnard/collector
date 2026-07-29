/**
 * Facade-adjacent domain shapes that today also appear in `@collector/core` / app.
 * Declared here so `@collector/api` stays free of core runtime.
 */

import type { ItemFile, MediaFileMeta, SourceType, Tag } from "@collector/shared";

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

export interface UpdateItemInput {
  title?: string;
  description?: string;
  url?: string | null;
  content_type?: ItemFile["content_type"];
  content?: string | null;
  /** Tag names as in the vault .md frontmatter; missing names are created. */
  tags?: string[];
  folder_path?: string;
}

/** Transport-honest binary file payload (#364). */
export interface BinaryPayload {
  name: string;
  bytes: Uint8Array;
}

export type AttachMediaFileInput = BinaryPayload;
