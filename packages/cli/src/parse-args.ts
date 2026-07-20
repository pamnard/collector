/**
 * Minimal argv parser for the Collector CLI (#172/#173).
 */

import type { ContentType } from "@collector/shared";
import { CONTENT_TYPES } from "@collector/shared";

export type CliCommand =
  | { name: "health" }
  | { name: "search"; query: string }
  | { name: "get-item"; itemId: string }
  | {
      name: "create-item";
      title: string;
      content_type: ContentType;
      description?: string;
      url?: string | null;
      content?: string | null;
      folder_path?: string;
    }
  | {
      name: "update-item";
      itemId: string;
      title?: string;
      description?: string;
      url?: string | null;
      content?: string | null;
      folder_path?: string;
    }
  | { name: "delete-item"; itemId: string }
  | { name: "create-tag"; tagName: string; color?: string | null }
  | { name: "delete-tag"; tagId: string }
  | { name: "create-folder"; folderPath: string }
  | { name: "move-item"; itemId: string; folderPath: string };

export interface ParsedCliArgs {
  command: CliCommand;
  dataDir?: string;
  ipcPath?: string;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const ENDPOINT_FLAGS = new Set(["--data-dir", "--ipc-path"]);
const CREATE_ITEM_FLAGS = new Set([
  "--title",
  "--type",
  "--description",
  "--url",
  "--content",
  "--folder",
]);
const UPDATE_ITEM_FLAGS = new Set([
  "--title",
  "--description",
  "--url",
  "--content",
  "--folder",
]);
const CREATE_TAG_FLAGS = new Set(["--name", "--color"]);
const MOVE_ITEM_FLAGS = new Set(["--folder"]);

function readOpt(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx < 0) {
    return undefined;
  }
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new CliUsageError(`Missing value for ${name}`);
  }
  return value;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function stripKnownOpts(argv: string[], flags: Set<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (flags.has(arg) || ENDPOINT_FLAGS.has(arg)) {
      i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function parseContentType(raw: string | undefined): ContentType {
  const value = raw ?? "note";
  if (!(CONTENT_TYPES as readonly string[]).includes(value)) {
    throw new CliUsageError(
      `Invalid --type ${value}; expected one of ${CONTENT_TYPES.join("|")}`,
    );
  }
  return value as ContentType;
}

function withEndpoint(
  command: CliCommand,
  dataDir: string | undefined,
  ipcPath: string | undefined,
): ParsedCliArgs {
  return {
    command,
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(ipcPath === undefined ? {} : { ipcPath }),
  };
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const dataDir = readOpt(argv, "--data-dir");
  const ipcPath = readOpt(argv, "--ipc-path");
  if (dataDir !== undefined && ipcPath !== undefined) {
    throw new CliUsageError("Pass only one of --data-dir or --ipc-path");
  }
  if (dataDir === undefined && ipcPath === undefined) {
    throw new CliUsageError(
      "Service endpoint required: --data-dir <path> or --ipc-path <path>",
    );
  }

  const positional = stripKnownOpts(
    argv,
    new Set([
      ...CREATE_ITEM_FLAGS,
      ...UPDATE_ITEM_FLAGS,
      ...CREATE_TAG_FLAGS,
      ...MOVE_ITEM_FLAGS,
    ]),
  );
  const [command, ...rest] = positional;
  if (command === undefined) {
    throw new CliUsageError(
      "Usage: collector [--data-dir <dir>|--ipc-path <path>] <command> …",
    );
  }

  if (command === "health") {
    if (rest.length > 0) {
      throw new CliUsageError("health takes no positional arguments");
    }
    return withEndpoint({ name: "health" }, dataDir, ipcPath);
  }

  if (command === "search") {
    const query = rest.join(" ").trim();
    if (!query) {
      throw new CliUsageError("Usage: collector search <query>");
    }
    return withEndpoint({ name: "search", query }, dataDir, ipcPath);
  }

  if (command === "get-item") {
    const itemId = rest[0];
    if (!itemId || rest.length !== 1) {
      throw new CliUsageError("Usage: collector get-item <item-id>");
    }
    return withEndpoint({ name: "get-item", itemId }, dataDir, ipcPath);
  }

  if (command === "create-item") {
    if (rest.length > 0) {
      throw new CliUsageError(
        "Usage: collector create-item --title <title> [--type note|…] [--content …] [--url …] [--folder …] [--description …]",
      );
    }
    const title = readOpt(argv, "--title");
    if (!title) {
      throw new CliUsageError("create-item requires --title");
    }
    const description = readOpt(argv, "--description");
    const url = hasFlag(argv, "--url") ? (readOpt(argv, "--url") ?? null) : undefined;
    const content = readOpt(argv, "--content");
    const folder_path = readOpt(argv, "--folder");
    return withEndpoint(
      {
        name: "create-item",
        title,
        content_type: parseContentType(readOpt(argv, "--type")),
        ...(description === undefined ? {} : { description }),
        ...(url === undefined ? {} : { url }),
        ...(content === undefined ? {} : { content }),
        ...(folder_path === undefined ? {} : { folder_path }),
      },
      dataDir,
      ipcPath,
    );
  }

  if (command === "update-item") {
    const itemId = rest[0];
    if (!itemId || rest.length !== 1) {
      throw new CliUsageError(
        "Usage: collector update-item <item-id> [--title …] [--content …] [--url …] [--folder …] [--description …]",
      );
    }
    const title = readOpt(argv, "--title");
    const description = readOpt(argv, "--description");
    const url = hasFlag(argv, "--url") ? (readOpt(argv, "--url") ?? null) : undefined;
    const content = readOpt(argv, "--content");
    const folder_path = readOpt(argv, "--folder");
    if (
      title === undefined &&
      description === undefined &&
      url === undefined &&
      content === undefined &&
      folder_path === undefined
    ) {
      throw new CliUsageError("update-item requires at least one field flag");
    }
    return withEndpoint(
      {
        name: "update-item",
        itemId,
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
        ...(url === undefined ? {} : { url }),
        ...(content === undefined ? {} : { content }),
        ...(folder_path === undefined ? {} : { folder_path }),
      },
      dataDir,
      ipcPath,
    );
  }

  if (command === "delete-item") {
    const itemId = rest[0];
    if (!itemId || rest.length !== 1) {
      throw new CliUsageError("Usage: collector delete-item <item-id>");
    }
    return withEndpoint({ name: "delete-item", itemId }, dataDir, ipcPath);
  }

  if (command === "create-tag") {
    if (rest.length > 0) {
      throw new CliUsageError(
        "Usage: collector create-tag --name <name> [--color <color>]",
      );
    }
    const tagName = readOpt(argv, "--name");
    if (!tagName) {
      throw new CliUsageError("create-tag requires --name");
    }
    const color = readOpt(argv, "--color");
    return withEndpoint(
      {
        name: "create-tag",
        tagName,
        ...(color === undefined ? {} : { color }),
      },
      dataDir,
      ipcPath,
    );
  }

  if (command === "delete-tag") {
    const tagId = rest[0];
    if (!tagId || rest.length !== 1) {
      throw new CliUsageError("Usage: collector delete-tag <tag-id>");
    }
    return withEndpoint({ name: "delete-tag", tagId }, dataDir, ipcPath);
  }

  if (command === "create-folder") {
    const folderPath = rest.join(" ").trim();
    if (!folderPath) {
      throw new CliUsageError("Usage: collector create-folder <path>");
    }
    return withEndpoint({ name: "create-folder", folderPath }, dataDir, ipcPath);
  }

  if (command === "move-item") {
    const itemId = rest[0];
    const folderPath = readOpt(argv, "--folder");
    if (!itemId || rest.length !== 1 || folderPath === undefined) {
      throw new CliUsageError(
        "Usage: collector move-item <item-id> --folder <path>",
      );
    }
    return withEndpoint(
      { name: "move-item", itemId, folderPath },
      dataDir,
      ipcPath,
    );
  }

  throw new CliUsageError(`Unknown command: ${command}`);
}
