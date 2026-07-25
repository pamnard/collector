/**
 * Collect files from a HTML5 drop (files + recursive directories via webkitGetAsEntry).
 */

export interface DroppedFileBytes {
  /** Path within the drop tree, including filename (e.g. `Trip/a.png`). */
  relativePath: string;
  filename: string;
  data: Uint8Array;
}

function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          readBatch();
        },
        reject,
      );
    };
    readBatch();
  });
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: DroppedFileBytes[],
): Promise<void> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntry);
    const relativePath = prefix ? `${prefix}/${file.name}` : file.name;
    out.push({
      relativePath,
      filename: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
    });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllDirectoryEntries(reader);
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    for (const child of children) {
      await walkEntry(child, nextPrefix, out);
    }
  }
}

export async function collectDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<DroppedFileBytes[]> {
  const items = dataTransfer.items;
  if (items && items.length > 0) {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i]?.webkitGetAsEntry?.() ?? null;
      if (entry) {
        entries.push(entry);
      }
    }
    if (entries.length > 0) {
      const out: DroppedFileBytes[] = [];
      for (const entry of entries) {
        await walkEntry(entry, "", out);
      }
      return out;
    }
  }

  const files = [...dataTransfer.files];
  const out: DroppedFileBytes[] = [];
  for (const file of files) {
    out.push({
      relativePath: file.name,
      filename: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
    });
  }
  return out;
}
