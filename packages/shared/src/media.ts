import { z } from "zod";
import type { MediaType } from "./constants.js";
import { mediaFileMetaSchema } from "./schemas.js";

export const mediaManifestSchema = z.object({
  files: z.array(mediaFileMetaSchema).default([]),
});

export type MediaManifest = z.infer<typeof mediaManifestSchema>;

export function inferMediaType(filename: string): MediaType {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"].includes(ext)) {
    return "image";
  }
  if (["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) {
    return "video";
  }
  if (ext === "pdf") {
    return "pdf";
  }
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext)) {
    return "audio";
  }
  if (["doc", "docx", "txt", "md", "rtf"].includes(ext)) {
    return "document";
  }
  return "other";
}

export function sanitizeMediaFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "file";
}
