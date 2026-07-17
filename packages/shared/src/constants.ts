export const CONTENT_TYPES = [
  "article",
  "video",
  "image",
  "note",
  "bookmark",
  "pdf",
  "audio",
  "other",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const SOURCE_TYPES = [
  "api",
  "telegram",
  "browser",
  "youtube",
  "manual",
  "import",
  "plugin",
  "other",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export const MEDIA_TYPES = [
  "image",
  "video",
  "pdf",
  "audio",
  "document",
  "other",
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export const SCHEMA_VERSION = 3;

export const VAULT_DIRS = {
  items: "items",
  media: "media",
} as const;

export const ITEM_FILES = {
  /** Canonical on-disk document (YAML frontmatter + body). */
  meta: "content.md",
  content: "content.md",
  /** Pre-v3 sidecar; migration reads then deletes. */
  legacyMeta: "item.json",
  source: ".source.json",
  mediaManifest: "manifest.json",
  cover: "cover.webp",
} as const;

export const VAULT_FILES = {
  meta: "vault.meta.json",
  tags: "tags.json",
  folders: "folders.json",
} as const;
