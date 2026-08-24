import {
  classifyDropFilename,
  parseDocumentMarkdown,
  partitionDocumentFrontmatter,
} from "@collector/core";
import { readFile } from "node:fs/promises";
import type { ImportFolderSourceFile } from "./import-folder-walk.js";
import type { MutableImportFolderResult } from "./import-folder-result.js";
import { pushImportFolderFailureSample } from "./import-folder-result.js";
import {
  importFolderErrorMessage,
  isFatalImportFolderError,
} from "./import-folder-fatal.js";

function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
}

/** Canonical url from note frontmatter when present and non-empty. */
export function canonicalUrlFromNoteBytes(bytes: Uint8Array): string | null {
  const parsed = parseDocumentMarkdown(decodeUtf8(bytes));
  const { known } = partitionDocumentFrontmatter(parsed.frontmatter);
  const url = known.url;
  if (typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type ImportFolderFileStepOutcome =
  | { kind: "skipped_kind" }
  | { kind: "skipped_existing"; itemId: string }
  | { kind: "imported"; createdIds: string[] }
  | { kind: "per_file_fail"; error: string }
  | { kind: "fatal"; error: string };

export type ImportFolderFileImporter = {
  importDroppedFiles: (input: {
    folder_path: string | undefined;
    files: Array<{
      name: string;
      relativePath: string;
      bytes: Uint8Array;
    }>;
  }) => Promise<{ createdIds: string[] }>;
};

/**
 * One source file through classify → optional url skip → drop-import.
 * Fatal infrastructure errors abort; other errors become per-file samples.
 */
export async function importOneFolderFile(input: {
  file: ImportFolderSourceFile;
  vaultId: string;
  folder_path: string | undefined;
  importer: ImportFolderFileImporter;
  assertActiveVault: (vaultId: string) => Promise<void>;
  findItemIdByUrl: (vaultId: string, url: string) => Promise<string | null>;
}): Promise<ImportFolderFileStepOutcome> {
  const classified = classifyDropFilename(input.file.name);
  if (classified.kind === "skip") {
    return { kind: "skipped_kind" };
  }

  try {
    await input.assertActiveVault(input.vaultId);
    const bytes = new Uint8Array(await readFile(input.file.absPath));

    if (classified.kind === "note") {
      const url = canonicalUrlFromNoteBytes(bytes);
      if (url) {
        // Index lookup: infrastructure failure aborts (no per-file swallow).
        const existingId = await input.findItemIdByUrl(input.vaultId, url);
        if (existingId) {
          return { kind: "skipped_existing", itemId: existingId };
        }
      }
    }

    const imported = await input.importer.importDroppedFiles({
      folder_path: input.folder_path,
      files: [
        {
          name: input.file.name,
          relativePath: input.file.relativePath,
          bytes,
        },
      ],
    });
    return { kind: "imported", createdIds: [...imported.createdIds] };
  } catch (error) {
    if (isFatalImportFolderError(error)) {
      return { kind: "fatal", error: importFolderErrorMessage(error) };
    }
    return { kind: "per_file_fail", error: importFolderErrorMessage(error) };
  }
}

export function applyImportFolderFileOutcome(
  result: MutableImportFolderResult,
  file: ImportFolderSourceFile,
  outcome: ImportFolderFileStepOutcome,
): void {
  if (outcome.kind === "skipped_existing") {
    result.skippedIds.push(outcome.itemId);
    return;
  }
  if (outcome.kind === "imported") {
    for (const id of outcome.createdIds) {
      result.createdIds.push(id);
    }
    return;
  }
  if (outcome.kind === "per_file_fail") {
    result.failedCount += 1;
    pushImportFolderFailureSample(
      result.failures,
      file.relativePath,
      outcome.error,
    );
  }
}
