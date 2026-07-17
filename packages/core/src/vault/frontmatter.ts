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

const KNOWN_FM_KEYS = new Set([
  "title",
  "description",
  "url",
  "content_type",
  "type",
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

export function parseKnownFrontmatter(
  frontmatter: Record<string, unknown>,
): DocumentFrontmatter {
  const result = documentFrontmatterSchema.safeParse(frontmatter);
  if (!result.success) {
    throw new Error(`Invalid frontmatter fields: ${result.error.message}`);
  }
  return result.data;
}

function dateToIso(value: string | Date | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date in frontmatter: ${value}`);
  }
  // Prefer original if already ISO-like
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return parsed.toISOString();
  }
  return parsed.toISOString();
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

export function contentTypeFromFrontmatter(fm: DocumentFrontmatter): DocumentFrontmatter["content_type"] {
  return fm.content_type ?? fm.type;
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

/**
 * Build canonical frontmatter object for writers (YAML only).
 * Drops empty optional fields; keeps unknown portable keys from `extra`.
 */
export function buildCanonicalFrontmatter(input: {
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
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    title: input.title,
  };
  if (input.description) {
    data.description = input.description;
  }
  if (input.url !== undefined && input.url !== null && input.url !== "") {
    data.url = input.url;
  }
  if (input.content_type) {
    data.content_type = input.content_type;
  }
  if (input.source_type) {
    data.source_type = input.source_type;
  }
  if (input.source_id !== undefined && input.source_id !== null && input.source_id !== "") {
    data.source_id = input.source_id;
  }
  if (input.tags && input.tags.length > 0) {
    data.tags = [...input.tags];
  }
  if (input.thumbnail !== undefined && input.thumbnail !== null && input.thumbnail !== "") {
    data.thumbnail = input.thumbnail;
  }
  if (input.content_revision !== undefined) {
    data.content_revision = input.content_revision;
  }
  if (input.created) {
    data.created = input.created;
  }
  if (input.updated) {
    data.updated = input.updated;
  }
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    data.metadata = input.metadata;
  }
  if (input.extra) {
    for (const [key, value] of Object.entries(input.extra)) {
      if (KNOWN_FM_KEYS.has(key)) {
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

export function extractUnknownFrontmatterKeys(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!KNOWN_FM_KEYS.has(key)) {
      extra[key] = value;
    }
  }
  return extra;
}
