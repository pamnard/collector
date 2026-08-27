import { isItemIdSortDir, isItemIdSortKey } from "@collector/core";
import { readOpt } from "../helpers.js";
import { CliUsageError, type CliCommand } from "../types.js";

export const LIST_FOLDER_ITEMS_FLAGS = new Set(["--sort", "--dir"]);

const LIST_FOLDER_ITEMS_USAGE =
  "Usage: collector-cli list-folder-items <path> " +
  "[--sort title|created_at|updated_at|content_type|word_count|character_count] " +
  "[--dir asc|desc]";

export function parseCreateFolder(_argv: string[], rest: string[]): CliCommand {
  const folderPath = rest.join(" ").trim();
  if (!folderPath) {
    throw new CliUsageError("Usage: collector-cli create-folder <path>");
  }
  return { name: "create-folder", folderPath };
}

export function parseListFolders(_argv: string[], rest: string[]): CliCommand {
  if (rest.length !== 0) {
    throw new CliUsageError("Usage: collector-cli list-folders");
  }
  return { name: "list-folders" };
}

export function parseListFolderItems(
  argv: string[],
  rest: string[],
): CliCommand {
  const folderPath = rest.join(" ").trim();
  const sortKey = readOpt(argv, "--sort");
  const sortDir = readOpt(argv, "--dir");
  if (!folderPath) {
    throw new CliUsageError(LIST_FOLDER_ITEMS_USAGE);
  }
  if (sortKey === undefined && sortDir === undefined) {
    return { name: "list-folder-items", folderPath };
  }
  if (sortKey === undefined || sortDir === undefined) {
    throw new CliUsageError(
      `${LIST_FOLDER_ITEMS_USAGE} (--sort and --dir must be used together)`,
    );
  }
  if (!isItemIdSortKey(sortKey)) {
    throw new CliUsageError(
      `Invalid --sort ${sortKey}; expected one of title|created_at|updated_at|content_type|word_count|character_count`,
    );
  }
  if (!isItemIdSortDir(sortDir)) {
    throw new CliUsageError(`Invalid --dir ${sortDir}; expected asc|desc`);
  }
  return {
    name: "list-folder-items",
    folderPath,
    sort: { key: sortKey, dir: sortDir },
  };
}

export function parseRenameFolder(_argv: string[], rest: string[]): CliCommand {
  const oldPath = rest[0];
  const newPath = rest[1];
  if (!oldPath || !newPath || rest.length !== 2) {
    throw new CliUsageError(
      "Usage: collector-cli rename-folder <old-path> <new-path>",
    );
  }
  return { name: "rename-folder", oldPath, newPath };
}

export function parseMoveFolder(_argv: string[], rest: string[]): CliCommand {
  const oldPath = rest[0];
  const newPath = rest[1];
  if (!oldPath || !newPath || rest.length !== 2) {
    throw new CliUsageError(
      "Usage: collector-cli move-folder <old-path> <new-path> " +
        "(alias of rename-folder; same host rename path)",
    );
  }
  return { name: "move-folder", oldPath, newPath };
}

export function parseDeleteFolder(_argv: string[], rest: string[]): CliCommand {
  const folderPath = rest.join(" ").trim();
  if (!folderPath) {
    throw new CliUsageError("Usage: collector-cli delete-folder <path>");
  }
  return { name: "delete-folder", folderPath };
}

export { LIST_FOLDER_ITEMS_USAGE };
