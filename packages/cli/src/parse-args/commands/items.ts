import {
  hasFlag,
  parseContentType,
  parseTagNames,
  readOpt,
  readOptAllowLeadingDash,
} from "../helpers.js";
import { CliUsageError, type CliCommand } from "../types.js";

export const CREATE_ITEM_FLAGS = new Set([
  "--title",
  "--type",
  "--description",
  "--url",
  "--content",
  "--folder",
]);
export const UPDATE_ITEM_FLAGS = new Set([
  "--title",
  "--description",
  "--url",
  "--content",
  "--type",
  "--tags",
  "--folder",
]);
export const UPDATE_ITEM_SOURCE_FLAGS = new Set(["--content"]);
export const MOVE_ITEM_FLAGS = new Set(["--folder"]);

export function parseGetItem(_argv: string[], rest: string[]): CliCommand {
  const itemId = rest[0];
  if (!itemId || rest.length !== 1) {
    throw new CliUsageError("Usage: collector-cli get-item <item-id>");
  }
  return { name: "get-item", itemId };
}

export function parseGetItemSource(_argv: string[], rest: string[]): CliCommand {
  const itemId = rest[0];
  if (!itemId || rest.length !== 1) {
    throw new CliUsageError("Usage: collector-cli get-item-source <item-id>");
  }
  return { name: "get-item-source", itemId };
}

export function parseCreateItem(argv: string[], rest: string[]): CliCommand {
  if (rest.length > 0) {
    throw new CliUsageError(
      "Usage: collector-cli create-item --title <title> [--type note|…] [--content …] [--url …] [--folder …] [--description …]",
    );
  }
  const title = readOpt(argv, "--title");
  if (!title) {
    throw new CliUsageError("create-item requires --title");
  }
  const description = readOpt(argv, "--description");
  const url = hasFlag(argv, "--url") ? (readOpt(argv, "--url") ?? null) : undefined;
  const content = readOptAllowLeadingDash(argv, "--content");
  const folder_path = readOpt(argv, "--folder");
  return {
    name: "create-item",
    title,
    content_type: parseContentType(readOpt(argv, "--type")),
    ...(description === undefined ? {} : { description }),
    ...(url === undefined ? {} : { url }),
    ...(content === undefined ? {} : { content }),
    ...(folder_path === undefined ? {} : { folder_path }),
  };
}

export function parseUpdateItem(argv: string[], rest: string[]): CliCommand {
  const itemId = rest[0];
  if (!itemId || rest.length !== 1) {
    throw new CliUsageError(
      "Usage: collector-cli update-item <item-id> [--title …] [--content …] [--url …] [--type …] [--tags name,…] [--folder …] [--description …]",
    );
  }
  const title = readOpt(argv, "--title");
  const description = readOpt(argv, "--description");
  const url = hasFlag(argv, "--url") ? (readOpt(argv, "--url") ?? null) : undefined;
  const content = readOptAllowLeadingDash(argv, "--content");
  const typeRaw = readOpt(argv, "--type");
  const content_type =
    typeRaw === undefined ? undefined : parseContentType(typeRaw);
  const tagsRaw = readOpt(argv, "--tags");
  const tags = tagsRaw === undefined ? undefined : parseTagNames(tagsRaw);
  const folder_path = readOpt(argv, "--folder");
  if (
    title === undefined &&
    description === undefined &&
    url === undefined &&
    content === undefined &&
    content_type === undefined &&
    tags === undefined &&
    folder_path === undefined
  ) {
    throw new CliUsageError("update-item requires at least one field flag");
  }
  return {
    name: "update-item",
    itemId,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(url === undefined ? {} : { url }),
    ...(content === undefined ? {} : { content }),
    ...(content_type === undefined ? {} : { content_type }),
    ...(tags === undefined ? {} : { tags }),
    ...(folder_path === undefined ? {} : { folder_path }),
  };
}

export function parseUpdateItemSource(
  argv: string[],
  rest: string[],
): CliCommand {
  const itemId = rest[0];
  if (!itemId || rest.length !== 1) {
    throw new CliUsageError(
      "Usage: collector-cli update-item-source <item-id> --content <raw-markdown>",
    );
  }
  const rawMarkdown = readOptAllowLeadingDash(argv, "--content");
  if (rawMarkdown === undefined) {
    throw new CliUsageError("update-item-source requires --content");
  }
  return { name: "update-item-source", itemId, rawMarkdown };
}

export function parseDeleteItem(_argv: string[], rest: string[]): CliCommand {
  const itemId = rest[0];
  if (!itemId || rest.length !== 1) {
    throw new CliUsageError("Usage: collector-cli delete-item <item-id>");
  }
  return { name: "delete-item", itemId };
}

export function parseMoveItem(argv: string[], rest: string[]): CliCommand {
  const itemId = rest[0];
  const folderPath = readOpt(argv, "--folder");
  if (!itemId || rest.length !== 1 || folderPath === undefined) {
    throw new CliUsageError(
      "Usage: collector-cli move-item <item-id> --folder <path> " +
        "(alias of update-item --folder; same host move path)",
    );
  }
  return { name: "move-item", itemId, folderPath };
}

export const IMPORT_FOLDER_FLAGS = new Set(["--path", "--folder", "--wait"]);

export function parseImportFolder(argv: string[], rest: string[]): CliCommand {
  if (rest.length > 0) {
    throw new CliUsageError(
      "Usage: collector-cli import-folder --path <abs-dir> [--folder <vault-folder>] [--wait]",
    );
  }
  const sourceDirAbs = readOpt(argv, "--path");
  if (!sourceDirAbs) {
    throw new CliUsageError("import-folder requires --path");
  }
  const folder_path = readOpt(argv, "--folder");
  return {
    name: "import-folder",
    sourceDirAbs,
    wait: hasFlag(argv, "--wait"),
    ...(folder_path === undefined ? {} : { folder_path }),
  };
}
