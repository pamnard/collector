/**
 * Facade-adjacent domain shapes that today also appear in `@collector/core` / app.
 * Declared here so `@collector/api` stays free of core runtime.
 */

import type { ItemFile, MediaFileMeta, Tag } from "@collector/shared";

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
}

export interface UpdateItemInput {
  title?: string;
  description?: string;
  url?: string | null;
  content_type?: ItemFile["content_type"];
  content?: string | null;
  tag_ids?: string[];
  folder_path?: string;
}

export interface AttachMediaFileInput {
  filename: string;
  data: Uint8Array;
}
