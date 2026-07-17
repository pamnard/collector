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

export const itemFileSchema = z.object({
  id: z.string().uuid(),
  vault_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().default(""),
  url: z.string().url().nullable().optional(),
  content_type: contentTypeSchema.default("bookmark"),
  source_type: sourceTypeSchema.default("manual"),
  source_id: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
  thumbnail: z.string().nullable().optional(),
  is_archived: z.boolean().default(false),
  is_favorite: z.boolean().default(false),
  tag_ids: z.array(z.string().uuid()).default([]),
  collection_ids: z.array(z.string().uuid()).default([]),
  folder_path: z.string().default(""),
  content_revision: z.number().int().default(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});


/** Known YAML frontmatter fields written for Collector documents. */
export const documentFrontmatterSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  url: z.string().url().nullable().optional(),
  content_type: contentTypeSchema.optional(),
  type: contentTypeSchema.optional(),
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
  is_archived: z.boolean().optional(),
  is_favorite: z.boolean().optional(),
  folder_path: z.string().optional(),
  collection_ids: z.array(z.string().uuid()).optional(),
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
  item_id: z.string().uuid(),
  filename: z.string().min(1),
  media_type: mediaTypeSchema.default("image"),
  created_at: z.string().datetime(),
});

export type ItemFile = z.infer<typeof itemFileSchema>;
export type DocumentFrontmatter = z.infer<typeof documentFrontmatterSchema>;
export type VaultMeta = z.infer<typeof vaultMetaSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type MediaFileMeta = z.infer<typeof mediaFileMetaSchema>;
