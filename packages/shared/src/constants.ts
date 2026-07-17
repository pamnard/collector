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

/** On-disk vault layout: FS folder tree + path-as-id documents. */
export const SCHEMA_VERSION = 4;

/** Legacy flat UUID item dirs (pre–schema 4). */
export const LEGACY_VAULT_DIRS = {
  items: "items",
} as const;

export const VAULT_DIRS = {
  media: "media",
} as const;

/** Sidecar dir next to `note.md` → `note.media/`. */
export const ITEM_MEDIA_SUFFIX = ".media";

export const ITEM_FILES = {
  source: ".source.json",
  mediaManifest: "manifest.json",
  cover: "cover.webp",
  /** Legacy only — migration reads these. */
  legacyMeta: "item.json",
  legacyContent: "content.md",
} as const;

export const VAULT_FILES = {
  meta: "vault.meta.json",
  tags: "tags.json",
  /** Legacy only — migration may read then delete. */
  legacyFolders: "folders.json",
} as const;

/** Filenames / top-level names that are never markdown items. */
export const RESERVED_VAULT_ENTRIES = new Set<string>([
  VAULT_FILES.meta,
  VAULT_FILES.tags,
  VAULT_FILES.legacyFolders,
  LEGACY_VAULT_DIRS.items,
  ".collector-touch",
]);
