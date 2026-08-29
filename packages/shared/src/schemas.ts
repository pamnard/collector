import { z } from "zod";
import {
  CONTENT_TYPES,
  MEDIA_TYPES,
  SCHEMA_VERSION,
  SOURCE_TYPES,
} from "./constants.js";

export const contentTypeSchema = z.enum(CONTENT_TYPES);
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export const mediaTypeSchema = z.enum(MEDIA_TYPES);

export const sourceRefSchema = z.object({
  plugin_id: z.string().min(1),
  external_id: z.string().min(1),
  synced_at: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Assembled item DTO (path + frontmatter + resolved dates).
 * `id` is the vault-relative posix path of the `.md` file.
 * `folder_path` is derived from `id` (dirname), not stored in frontmatter.
 */
export const itemFileSchema = z.object({
  id: z.string().min(1),
  vault_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().default(""),
  url: z.string().url().nullable().optional(),
  content_type: contentTypeSchema.default("bookmark"),
  source_type: sourceTypeSchema.default("manual"),
  source_id: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
  /** Unknown / foreign frontmatter keys (open map; not an allowlist). */
  properties: z.record(z.unknown()).default({}),
  thumbnail: z.string().nullable().optional(),
  tag_ids: z.array(z.string().uuid()).default([]),
  collection_ids: z.array(z.string().uuid()).default([]),
  folder_path: z.string().default(""),
  content_revision: z.number().int().default(1),
  /** Derived index fields (not frontmatter); queryable for sort/top-N. */
  word_count: z.number().int().nonnegative().default(0),
  character_count: z.number().int().nonnegative().default(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

/** Known YAML frontmatter fields written for Collector documents. */
export const documentFrontmatterSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  url: z.string().url().nullable().optional(),
  content_type: contentTypeSchema.optional(),
  source_type: sourceTypeSchema.optional(),
  source_id: z.string().nullable().optional(),
  thumbnail: z.string().nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
  content_revision: z.number().int().optional(),
  created: z.union([z.string(), z.date()]).optional(),
  created_at: z.union([z.string(), z.date()]).optional(),
  updated: z.union([z.string(), z.date()]).optional(),
  updated_at: z.union([z.string(), z.date()]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const vaultMetaSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().default(""),
  is_default: z.boolean().default(false),
  schema_version: z.number().int().default(SCHEMA_VERSION),
  settings: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const mediaFileMetaSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().min(1),
  filename: z.string().min(1),
  media_type: mediaTypeSchema.default("image"),
  created_at: z.string().datetime(),
});

/** Positive cover.webp pixel size persisted beside the file (#822). */
export const coverPixelSizeSchema = z.object({
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
});

/** Gallery mediaId that built cover.webp (hero full-res display). */
export const coverSourceSchema = z.object({
  mediaId: z.string().min(1),
  /** Original filename when known — enables O(1) display resolve (#879). */
  filename: z.string().min(1).optional(),
});

export type ItemFile = z.infer<typeof itemFileSchema>;
export type DocumentFrontmatter = z.infer<typeof documentFrontmatterSchema>;
export type VaultMeta = z.infer<typeof vaultMetaSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type MediaFileMeta = z.infer<typeof mediaFileMetaSchema>;
export type CoverPixelSize = z.infer<typeof coverPixelSizeSchema>;
export type CoverSource = z.infer<typeof coverSourceSchema>;

/** Encoded cover.webp bytes plus true output WxH from generateCover. */
export type GeneratedCover = {
  data: Uint8Array;
  size: CoverPixelSize;
};
