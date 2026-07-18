import type { FileSystemAdapter } from "../adapters/types.js";
import {
  parseDocumentMarkdown,
  resolveFrontmatterDates,
} from "./frontmatter.js";

/**
 * If mtime is missing, touch once and re-stat. No retry loop.
 * Returns null when mtime is still unavailable after the single heal attempt.
 */
export async function recoverItemDiskMtimeMs(
  fs: FileSystemAdapter,
  docPath: string,
): Promise<number | null> {
  const first = await fs.stat(docPath);
  if (first.mtimeMs !== null) {
    return first.mtimeMs;
  }
  await fs.touch(docPath);
  const second = await fs.stat(docPath);
  return second.mtimeMs;
}

export function fileMtimeMsFromUpdatedAt(updatedAt: string): number {
  const ms = Date.parse(updatedAt);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid updated_at for file mtime: ${updatedAt}`);
  }
  return ms;
}

/** Derive disk mtime for index upsert when FS mtime is unavailable. */
export function diskMtimeMsFromDocumentMarkdown(raw: string): number {
  const { frontmatter } = parseDocumentMarkdown(raw);
  const dates = resolveFrontmatterDates(frontmatter);
  if (!dates.updated_at) {
    throw new Error(
      "Document missing updated/updated_at; cannot derive file mtime",
    );
  }
  return fileMtimeMsFromUpdatedAt(dates.updated_at);
}
