/**
 * Drop-import orchestration (#22): classify files, create items, attach media / write notes.
 */

import type {
  CreateItemInput,
  ImportDroppedFilesInput,
  ImportDroppedFilesResult,
  AttachMediaFileInput,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  classifyDropFilename,
  parseDocumentMarkdown,
  partitionDocumentFrontmatter,
  resolveDropTitle,
  serializeDocumentMarkdown,
  titleStemFromFilename,
} from "@collector/core";
import {
  folderPathFromItemPath,
  normalizeFolderPath,
} from "@collector/shared";

export interface DropImportServiceDeps {
  createItem: (input: CreateItemInput) => Promise<ItemFile>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
  updateItemSource: (
    itemId: string,
    rawMarkdown: string,
  ) => Promise<ItemFile>;
}

export interface DropImportService {
  importDroppedFiles(
    input: ImportDroppedFilesInput,
  ): Promise<ImportDroppedFilesResult>;
}

/** Join list-target folder with dirname of relativePath inside the drop tree. */
export function resolveImportItemFolder(
  targetFolderPath: string | undefined,
  relativePath: string,
): string | undefined {
  const normalizedRel = normalizeFolderPath(relativePath.replace(/\\/g, "/"));
  const nested = folderPathFromItemPath(normalizedRel);
  const target = targetFolderPath?.trim() ?? "";
  if (!target && !nested) {
    return undefined;
  }
  if (!target) {
    return nested;
  }
  if (!nested) {
    return normalizeFolderPath(target);
  }
  return normalizeFolderPath(`${target}/${nested}`);
}

function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
}

/** Ensure dropped markdown keeps note/import types when FM omits them. */
export function prepareDroppedNoteMarkdown(raw: string, title: string): string {
  const parsed = parseDocumentMarkdown(raw);
  const { known, properties } = partitionDocumentFrontmatter(parsed.frontmatter);
  const frontmatter: Record<string, unknown> = { ...properties };
  for (const [key, value] of Object.entries(known)) {
    if (value !== undefined) {
      frontmatter[key] = value;
    }
  }
  if (typeof frontmatter.title !== "string" || !String(frontmatter.title).trim()) {
    frontmatter.title = title;
  }
  if (known.content_type === undefined) {
    frontmatter.content_type = "note";
  }
  if (known.source_type === undefined) {
    frontmatter.source_type = "import";
  }
  return serializeDocumentMarkdown(frontmatter, parsed.body);
}

export function createDropImportService(
  deps: DropImportServiceDeps,
): DropImportService {
  const importDroppedFiles = async (
    input: ImportDroppedFilesInput,
  ): Promise<ImportDroppedFilesResult> => {
    const createdIds: string[] = [];
    const target = input.folder_path?.trim() || undefined;

    for (const file of input.files) {
      const classified = classifyDropFilename(file.name);
      if (classified.kind === "skip") {
        continue;
      }

      const folder_path = resolveImportItemFolder(target, file.relativePath);

      if (classified.kind === "media") {
        const item = await deps.createItem({
          title: titleStemFromFilename(file.name),
          content_type: classified.contentType,
          folder_path,
          source_type: "import",
        });
        await deps.attachMediaFiles(item.id, [
          { name: file.name, bytes: file.bytes },
        ]);
        createdIds.push(item.id);
        continue;
      }

      const raw = decodeUtf8(file.bytes);
      const title = resolveDropTitle(file.name, raw);
      const item = await deps.createItem({
        title,
        content_type: "note",
        folder_path,
        source_type: "import",
      });
      await deps.updateItemSource(
        item.id,
        prepareDroppedNoteMarkdown(raw, title),
      );
      createdIds.push(item.id);
    }

    return { createdIds };
  };

  return { importDroppedFiles };
}
