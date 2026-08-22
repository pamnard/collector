import { documentFrontmatterSchema, type DocumentFrontmatter } from "@collector/shared";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type FrontmatterFormat = "yaml" | "json" | "toml";

export interface ParsedDocumentMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Format detected on read (writers always emit yaml). */
  detectedFormat: FrontmatterFormat | null;
}

/** Product keys projected into typed ItemFile fields / presentation. */
const PRODUCT_FM_KEYS = new Set([
  "title",
  "description",
  "url",
  "content_type",
  "source_type",
  "source_id",
  "thumbnail",
  "tags",
  "content_revision",
  "created",
  "created_at",
  "updated",
  "updated_at",
  "metadata",
]);

const DATE_FM_KEYS = new Set([
  "created",
  "created_at",
  "updated",
  "updated_at",
]);

/** Retired Collector-owned keys stripped on rewrite (deny-list, not allowlist). */
const LEGACY_STRIP_KEYS = new Set([
  "is_archived",
  "is_favorite",
  "folder_path",
  "collection_ids",
]);

/**
 * Stable YAML serialization: sort keys, JSON-compatible types only in dump.
 * Unknown keys are preserved alphabetically after known keys (known order first).
 */
const KNOWN_KEY_ORDER = [
  "title",
  "description",
  "url",
  "content_type",
  "source_type",
  "source_id",
  "tags",
  "thumbnail",
  "content_revision",
  "created",
  "updated",
  "metadata",
] as const;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detectDelimitedBlock(
  text: string,
): { open: string; close: string; format: FrontmatterFormat } | null {
  if (text.startsWith("---")) {
    return { open: "---", close: "---", format: "yaml" };
  }
  if (text.startsWith("+++")) {
    return { open: "+++", close: "+++", format: "toml" };
  }
  return null;
}

function parseFrontmatterBlock(
  raw: string,
  hinted: FrontmatterFormat,
): { data: Record<string, unknown>; format: FrontmatterFormat } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { data: {}, format: hinted };
  }

  if (hinted === "toml" || (hinted === "yaml" && trimmed.startsWith("+++"))) {
    const data = parseToml(trimmed);
    if (!isPlainObject(data)) {
      throw new Error("TOML frontmatter must be a table/object");
    }
    return { data, format: "toml" };
  }

  if (trimmed.startsWith("{")) {
    const data = JSON.parse(trimmed) as unknown;
    if (!isPlainObject(data)) {
      throw new Error("JSON frontmatter must be an object");
    }
    return { data, format: "json" };
  }

  // TOML already handled above when hinted === "toml" or +++ delimiter.
  const data = parseYaml(trimmed) as unknown;
  if (data === null || data === undefined) {
    return { data: {}, format: "yaml" };
  }
  if (!isPlainObject(data)) {
    throw new Error("YAML frontmatter must be a mapping/object");
  }
  return { data, format: "yaml" };
}

/**
 * Split markdown into frontmatter + body.
 * Supports `---` YAML/JSON and `+++` TOML. No frontmatter → empty object + full body.
 */
export function parseDocumentMarkdown(raw: string): ParsedDocumentMarkdown {
  const text = stripBom(raw).replace(/\r\n/g, "\n");
  const delim = detectDelimitedBlock(text);
  if (!delim) {
    return { frontmatter: {}, body: text, detectedFormat: null };
  }

  const afterOpen = text.slice(delim.open.length);
  if (afterOpen.startsWith("\n")) {
    // standard
  } else if (afterOpen.length === 0) {
    throw new Error("Invalid frontmatter: missing closing delimiter");
  } else if (!afterOpen.startsWith("\r")) {
    // allow --- immediately followed by content on same line only if JSON object
  }

  const rest = afterOpen.startsWith("\n") ? afterOpen.slice(1) : afterOpen;
  const closeIdx = rest.indexOf(`\n${delim.close}`);
  if (closeIdx === -1) {
    // closing --- at start of rest (empty FM) or end
    if (rest === delim.close || rest.startsWith(`${delim.close}\n`)) {
      const body =
        rest === delim.close ? "" : rest.slice(delim.close.length).replace(/^\n/, "");
      return { frontmatter: {}, body, detectedFormat: delim.format };
    }
    throw new Error("Invalid frontmatter: missing closing delimiter");
  }

  const fmRaw = rest.slice(0, closeIdx);
  let afterClose = rest.slice(closeIdx + 1 + delim.close.length);
  if (afterClose.startsWith("\n")) {
    afterClose = afterClose.slice(1);
  }

  const { data, format } = parseFrontmatterBlock(fmRaw, delim.format);
  return { frontmatter: data, body: afterClose, detectedFormat: format };
}

export type PartitionedFrontmatter = {
  known: DocumentFrontmatter;
  properties: Record<string, unknown>;
};

/**
 * Choose a demotion key for an invalid product value: `_key`, then `_key_2`, …
 * `occupied` is the set of keys already present in the output bag / raw map.
 */
export function demoteFrontmatterKey(
  key: string,
  occupied: Record<string, unknown>,
): string {
  const base = `_${key}`;
  if (!(base in occupied)) {
    return base;
  }
  let i = 2;
  while (`_${key}_${i}` in occupied) {
    i += 1;
  }
  return `_${key}_${i}`;
}

function tryDateToIso(value: string | Date): string | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return undefined;
    }
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function acceptProductField(
  key: string,
  value: unknown,
): { ok: true; value: unknown } | { ok: false } {
  const fieldSchema =
    documentFrontmatterSchema.shape[
      key as keyof typeof documentFrontmatterSchema.shape
    ];
  if (!fieldSchema) {
    return { ok: false };
  }
  const parsed = fieldSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false };
  }
  if (DATE_FM_KEYS.has(key)) {
    const dateValue = parsed.data as string | Date;
    if (tryDateToIso(dateValue) === undefined) {
      return { ok: false };
    }
  }
  return { ok: true, value: parsed.data };
}

/**
 * Soft-split raw frontmatter: valid product keys → known; everything else →
 * properties. Invalid values under product key names demote to `_key` (etc.).
 * Never throws on field values.
 */
export function partitionDocumentFrontmatter(
  frontmatter: Record<string, unknown>,
): PartitionedFrontmatter {
  const properties: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(frontmatter)) {
    if (LEGACY_STRIP_KEYS.has(key)) {
      continue;
    }
    if (!PRODUCT_FM_KEYS.has(key)) {
      properties[key] = value;
    }
  }

  const knownRaw: Record<string, unknown> = {};
  for (const key of PRODUCT_FM_KEYS) {
    if (!(key in frontmatter)) {
      continue;
    }
    const value = frontmatter[key];
    const accepted = acceptProductField(key, value);
    if (accepted.ok) {
      knownRaw[key] = accepted.value;
      continue;
    }
    const occupied = { ...frontmatter, ...properties };
    const demoted = demoteFrontmatterKey(key, occupied);
    properties[demoted] = value;
  }

  const knownResult = documentFrontmatterSchema.safeParse(knownRaw);
  return {
    known: knownResult.success ? knownResult.data : {},
    properties,
  };
}

/** Valid product projection only; invalid values are demoted (never throws). */
export function parseKnownFrontmatter(
  frontmatter: Record<string, unknown>,
): DocumentFrontmatter {
  return partitionDocumentFrontmatter(frontmatter).known;
}

function dateToIso(value: string | Date | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return tryDateToIso(value);
}

/** Resolve created/updated from FM aliases; missing → undefined (caller uses FS). */
export function resolveFrontmatterDates(fm: DocumentFrontmatter): {
  created_at?: string;
  updated_at?: string;
} {
  const created = dateToIso(fm.created_at ?? fm.created);
  const updated = dateToIso(fm.updated_at ?? fm.updated);
  return {
    created_at: created,
    updated_at: updated,
  };
}

export function contentTypeFromFrontmatter(
  fm: DocumentFrontmatter,
): DocumentFrontmatter["content_type"] {
  return fm.content_type;
}

function orderFrontmatterKeys(data: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of KNOWN_KEY_ORDER) {
    if (key in data && data[key] !== undefined) {
      ordered[key] = data[key];
    }
  }
  const rest = Object.keys(data)
    .filter((key) => !KNOWN_KEY_ORDER.includes(key as (typeof KNOWN_KEY_ORDER)[number]))
    .sort();
  for (const key of rest) {
    ordered[key] = data[key];
  }
  return ordered;
}

type CanonicalFrontmatterInput = {
  title: string;
  description?: string;
  url?: string | null;
  content_type?: string;
  source_type?: string;
  source_id?: string | null;
  tags?: string[];
  thumbnail?: string | null;
  content_revision?: number;
  created?: string;
  updated?: string;
  metadata?: Record<string, unknown>;
  properties?: Record<string, unknown>;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isPresentString(v: unknown): v is string {
  return v !== undefined && v !== null && v !== "";
}

function isNonEmptyStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0;
}

function isNonEmptyPlainObject(v: unknown): v is Record<string, unknown> {
  return isPlainObject(v) && Object.keys(v).length > 0;
}

type OptionalCanonicalField = {
  key: (typeof KNOWN_KEY_ORDER)[number];
  read: (input: CanonicalFrontmatterInput) => unknown;
  include: (value: unknown) => boolean;
  map?: (value: unknown) => unknown;
};

/** Optional fields in KNOWN_KEY_ORDER; title and `properties` handled separately. */
const OPTIONAL_CANONICAL_FIELDS: readonly OptionalCanonicalField[] = [
  { key: "description", read: (i) => i.description, include: isNonEmptyString },
  { key: "url", read: (i) => i.url, include: isPresentString },
  { key: "content_type", read: (i) => i.content_type, include: isNonEmptyString },
  { key: "source_type", read: (i) => i.source_type, include: isNonEmptyString },
  { key: "source_id", read: (i) => i.source_id, include: isPresentString },
  {
    key: "tags",
    read: (i) => i.tags,
    include: isNonEmptyStringArray,
    map: (v) => [...(v as string[])],
  },
  { key: "thumbnail", read: (i) => i.thumbnail, include: isPresentString },
  {
    key: "content_revision",
    read: (i) => i.content_revision,
    include: (v) => v !== undefined,
  },
  { key: "created", read: (i) => i.created, include: isNonEmptyString },
  { key: "updated", read: (i) => i.updated, include: isNonEmptyString },
  { key: "metadata", read: (i) => i.metadata, include: isNonEmptyPlainObject },
];

/**
 * Build canonical frontmatter object for writers (YAML only).
 * Drops empty optional fields; keeps unknown portable keys from `properties`.
 * Strips legacy deny-list keys.
 */
export function buildCanonicalFrontmatter(
  input: CanonicalFrontmatterInput,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    title: input.title,
  };
  for (const field of OPTIONAL_CANONICAL_FIELDS) {
    const raw = field.read(input);
    if (!field.include(raw)) {
      continue;
    }
    data[field.key] = field.map ? field.map(raw) : raw;
  }
  if (input.properties) {
    for (const [key, value] of Object.entries(input.properties)) {
      if (PRODUCT_FM_KEYS.has(key) || LEGACY_STRIP_KEYS.has(key)) {
        continue;
      }
      if (value !== undefined) {
        data[key] = value;
      }
    }
  }
  return orderFrontmatterKeys(data);
}

/** Serialize document with YAML frontmatter (canonical writer format). */
export function serializeDocumentMarkdown(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const ordered = orderFrontmatterKeys(frontmatter);
  const yamlBlock = stringifyYaml(ordered, {
    lineWidth: 0,
    defaultKeyType: "PLAIN",
    defaultStringType: "PLAIN",
  }).trimEnd();
  const normalizedBody = body.replace(/\r\n/g, "\n");
  if (!yamlBlock) {
    return normalizedBody;
  }
  if (normalizedBody.length === 0) {
    return `---\n${yamlBlock}\n---\n`;
  }
  return `---\n${yamlBlock}\n---\n${normalizedBody.startsWith("\n") ? normalizedBody.slice(1) : normalizedBody}`;
}

/**
 * Bump `content_revision` and `updated` after derived localize rewrites the vault
 * document (#768). Preserves body and other frontmatter fields.
 */
export function bumpContentRevisionInDocumentMarkdown(
  raw: string,
  updatedAt: string = new Date().toISOString(),
): string {
  const parsed = parseDocumentMarkdown(raw);
  const { known, properties } = partitionDocumentFrontmatter(parsed.frontmatter);
  const dates = resolveFrontmatterDates(known);
  const frontmatter = buildCanonicalFrontmatter({
    title: known.title ?? "Untitled",
    description: known.description,
    url: known.url,
    content_type: contentTypeFromFrontmatter(known) ?? known.content_type,
    source_type: known.source_type,
    source_id: known.source_id,
    tags: known.tags,
    thumbnail: known.thumbnail,
    content_revision: (known.content_revision ?? 1) + 1,
    created: dates.created_at,
    updated: updatedAt,
    metadata: known.metadata,
    properties,
  });
  return serializeDocumentMarkdown(frontmatter, parsed.body);
}

/** Foreign frontmatter keys (neither product projection nor legacy deny-list). */
export function extractUnknownFrontmatterKeys(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (PRODUCT_FM_KEYS.has(key) || LEGACY_STRIP_KEYS.has(key)) {
      continue;
    }
    properties[key] = value;
  }
  return properties;
}

/**
 * FTS fields from an on-disk note (#534): index the raw markdown file;
 * hasContentFile reflects non-empty body, not truthiness of the full document.
 */
export function ftsFieldsFromDocumentMarkdown(documentMarkdown: string): {
  content: string;
  hasContentFile: boolean;
} {
  return {
    content: documentMarkdown,
    hasContentFile: Boolean(parseDocumentMarkdown(documentMarkdown).body),
  };
}
