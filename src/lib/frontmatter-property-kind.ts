/**
 * Frontmatter property presentation kinds (#528).
 * Product keys get fixed kinds; foreign keys use value heuristics.
 */

export type PropertyKind =
  | "text"
  | "url"
  | "date"
  | "datetime"
  | "number"
  | "boolean"
  | "tags"
  | "folder"
  | "content_type"
  | "json";

const PRODUCT_KIND_BY_KEY: Record<string, PropertyKind> = {
  description: "text",
  url: "url",
  content_type: "content_type",
  source_type: "text",
  source_id: "text",
  tags: "tags",
  thumbnail: "text",
  content_revision: "number",
  created: "datetime",
  created_at: "datetime",
  updated: "datetime",
  updated_at: "datetime",
  folder_path: "folder",
  metadata: "json",
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const URL_RE = /^https?:\/\//i;

export function inferPropertyKind(
  key: string,
  value: unknown,
): PropertyKind {
  const product = PRODUCT_KIND_BY_KEY[key];
  if (product) {
    return product;
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (value !== null && typeof value === "object") {
    return "json";
  }
  if (typeof value === "string") {
    if (ISO_DATETIME_RE.test(value)) {
      return "datetime";
    }
    if (ISO_DATE_RE.test(value)) {
      return "date";
    }
    if (URL_RE.test(value)) {
      return "url";
    }
    return "text";
  }
  return "text";
}
