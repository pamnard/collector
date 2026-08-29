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

/**
 * After overwriting an existing item file, guarantee disk mtime advances.
 * Many filesystems keep the same mtime across rapid writeFile calls; stamps
 * and itemDerivedRefresh idempotency keys require a strict increase (#911).
 */
export async function ensureFileMtimeAdvanced(
  fs: FileSystemAdapter,
  docPath: string,
  previousMtimeMs: number,
): Promise<number> {
  const afterWrite = await fs.stat(docPath);
  if (
    afterWrite.mtimeMs !== null &&
    afterWrite.mtimeMs > previousMtimeMs
  ) {
    return afterWrite.mtimeMs;
  }
  const nextMtimeMs = Math.max(Date.now(), previousMtimeMs + 1);
  await fs.touch(docPath, nextMtimeMs);
  const healed = await fs.stat(docPath);
  if (healed.mtimeMs === null) {
    throw new Error(
      `ensureFileMtimeAdvanced: missing mtime after touch for ${docPath}`,
    );
  }
  if (healed.mtimeMs <= previousMtimeMs) {
    throw new Error(
      `ensureFileMtimeAdvanced: mtime did not advance for ${docPath} (was ${previousMtimeMs}, now ${healed.mtimeMs})`,
    );
  }
  return healed.mtimeMs;
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
