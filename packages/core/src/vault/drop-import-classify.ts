import {
  inferMediaType,
  type ContentType,
  type MediaType,
} from "@collector/shared";
import { basename } from "./paths.js";

export type DropImportClass =
  | { kind: "note" }
  | { kind: "media"; contentType: ContentType; mediaType: MediaType }
  | { kind: "skip" };

/** Filename stem for drop titles (extension stripped). */
export function titleStemFromFilename(filename: string): string {
  const base = basename(filename.replace(/\\/g, "/"));
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return base || "file";
  }
  return base.slice(0, dot) || base;
}

/**
 * Classify a dropped filename for import.
 * `.md` → note (not `inferMediaType` document). Media kinds map to item content_type.
 */
export function classifyDropFilename(filename: string): DropImportClass {
  const base = basename(filename.replace(/\\/g, "/"));
  const ext = base.includes(".")
    ? base.slice(base.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (ext === "md") {
    return { kind: "note" };
  }
  const mediaType = inferMediaType(base);
  if (
    mediaType === "image" ||
    mediaType === "video" ||
    mediaType === "audio" ||
    mediaType === "pdf"
  ) {
    return { kind: "media", contentType: mediaType, mediaType };
  }
  return { kind: "skip" };
}
