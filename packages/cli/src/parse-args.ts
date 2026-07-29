/**
 * Minimal argv parser for the Collector CLI (#172/#173).
 */

import type { ContentType } from "@collector/shared";
import { CONTENT_TYPES } from "@collector/shared";

export type CliCommand =
  | { name: "health" }
  | { name: "search"; query: string }
  | { name: "get-item"; itemId: string }
  | { name: "get-item-source"; itemId: string }
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
      content_type?: ContentType;
      tags?: string[];
      folder_path?: string;
    }
  | {
      name: "update-item-source";
      itemId: string;
      rawMarkdown: string;
    }
  | { name: "delete-item"; itemId: string }
  | { name: "create-tag"; tagName: string; color?: string | null }
  | { name: "delete-tag"; tagId: string }
  | { name: "create-folder"; folderPath: string }
  | { name: "list-folders" }
  | { name: "rename-folder"; oldPath: string; newPath: string }
  | { name: "move-folder"; oldPath: string; newPath: string }
  | { name: "delete-folder"; folderPath: string }
  | { name: "move-item"; itemId: string; folderPath: string }
  | { name: "list-item-media"; itemId: string }
  | {
      name: "attach-media";
      itemId: string;
      filePath: string;
      filename?: string;
    }
  | {
      name: "replace-media";
      itemId: string;
      mediaId: string;
      filePath: string;
      filename?: string;
    }
  | { name: "delete-media"; itemId: string; mediaId: string }
  | { name: "set-item-cover"; itemId: string; mediaId: string };

export interface ParsedCliArgs {
  command: CliCommand;
  dataDir?: string;
  ipcPath?: string;
  token?: string;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const ENDPOINT_FLAGS = new Set(["--data-dir", "--ipc-path", "--token"]);
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
  "--type",
  "--tags",
  "--folder",
]);
const UPDATE_ITEM_SOURCE_FLAGS = new Set(["--content"]);
const CREATE_TAG_FLAGS = new Set(["--name", "--color"]);
const MOVE_ITEM_FLAGS = new Set(["--folder"]);
const ATTACH_MEDIA_FLAGS = new Set(["--file", "--filename"]);
const REPLACE_MEDIA_FLAGS = new Set(["--file", "--filename"]);

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

/**
 * Like readOpt, but allows values that start with `-` (YAML frontmatter `---`).
 * Only rejects when the next argv slot is missing.
 */
function readOptAllowLeadingDash(
  argv: string[],
  name: string,
): string | undefined {
  const idx = argv.indexOf(name);
  if (idx < 0) {
    return undefined;
  }
  const value = argv[idx + 1];
  if (value === undefined) {
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

/** Comma-separated tag names; empty string → []. */
function parseTagNames(raw: string): string[] {
  if (raw.trim() === "") {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function withEndpoint(
  command: CliCommand,
  dataDir: string | undefined,
  ipcPath: string | undefined,
  token: string | undefined,
): ParsedCliArgs {
  return {
    command,
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(ipcPath === undefined ? {} : { ipcPath }),
    ...(token === undefined ? {} : { token }),
  };
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const dataDir = readOpt(argv, "--data-dir");
  const ipcPath = readOpt(argv, "--ipc-path");
  const tokenFlag = readOpt(argv, "--token");
  const tokenEnv = process.env.COLLECTOR_IPC_TOKEN?.trim();
  const resolvedToken =
    tokenFlag ??
    (tokenEnv !== undefined && tokenEnv.length > 0 ? tokenEnv : undefined);
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
      ...UPDATE_ITEM_SOURCE_FLAGS,
      ...CREATE_TAG_FLAGS,
      ...MOVE_ITEM_FLAGS,
      ...ATTACH_MEDIA_FLAGS,
      ...REPLACE_MEDIA_FLAGS,
    ]),
  );
  const [command, ...rest] = positional;
  if (command === undefined) {
    throw new CliUsageError(
      "Usage: collector-cli [--data-dir <dir>|--ipc-path <path>] [--token <secret>] <command> …",
    );
  }

  if (command === "health") {
    if (rest.length > 0) {
      throw new CliUsageError("health takes no positional arguments");
    }
    return withEndpoint({ name: "health" }, dataDir, ipcPath, resolvedToken);
  }

  if (command === "search") {
    const query = rest.join(" ").trim();
    if (!query) {
      throw new CliUsageError("Usage: collector-cli search <query>");
    }
    return withEndpoint({ name: "search", query }, dataDir, ipcPath, resolvedToken);
  }

  if (command === "get-item") {
    const itemId = rest[0];
    if (!itemId || rest.length !== 1) {
      throw new CliUsageError("Usage: collector-cli get-item <item-id>");
    }
    return withEndpoint({ name: "get-item", itemId }, dataDir, ipcPath, resolvedToken);
  }

  if (command === "get-item-source") {
    const itemId = rest[0];
    if (!itemId || rest.length !== 1) {
      throw new CliUsageError("Usage: collector-cli get-item-source <item-id>");
    }
    return withEndpoint(
      { name: "get-item-source", itemId },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "create-item") {
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
      resolvedToken,
    );
  }

  if (command === "update-item") {
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
    const tags =
      tagsRaw === undefined ? undefined : parseTagNames(tagsRaw);
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
    return withEndpoint(
      {
        name: "update-item",
        itemId,
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
        ...(url === undefined ? {} : { url }),
        ...(content === undefined ? {} : { content }),
        ...(content_type === undefined ? {} : { content_type }),
        ...(tags === undefined ? {} : { tags }),
        ...(folder_path === undefined ? {} : { folder_path }),
      },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "update-item-source") {
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
    return withEndpoint(
      { name: "update-item-source", itemId, rawMarkdown },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "delete-item") {
    const itemId = rest[0];
    if (!itemId || rest.length !== 1) {
      throw new CliUsageError("Usage: collector-cli delete-item <item-id>");
    }
    return withEndpoint({ name: "delete-item", itemId }, dataDir, ipcPath, resolvedToken);
  }

  if (command === "create-tag") {
    if (rest.length > 0) {
      throw new CliUsageError(
        "Usage: collector-cli create-tag --name <name> [--color <color>]",
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
      resolvedToken,
    );
  }

  if (command === "delete-tag") {
    const tagId = rest[0];
    if (!tagId || rest.length !== 1) {
      throw new CliUsageError("Usage: collector-cli delete-tag <tag-id>");
    }
    return withEndpoint({ name: "delete-tag", tagId }, dataDir, ipcPath, resolvedToken);
  }

  if (command === "create-folder") {
    const folderPath = rest.join(" ").trim();
    if (!folderPath) {
      throw new CliUsageError("Usage: collector-cli create-folder <path>");
    }
    return withEndpoint(
      { name: "create-folder", folderPath },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "list-folders") {
    if (rest.length !== 0) {
      throw new CliUsageError("Usage: collector-cli list-folders");
    }
    return withEndpoint({ name: "list-folders" }, dataDir, ipcPath, resolvedToken);
  }

  if (command === "rename-folder") {
    const oldPath = rest[0];
    const newPath = rest[1];
    if (!oldPath || !newPath || rest.length !== 2) {
      throw new CliUsageError(
        "Usage: collector-cli rename-folder <old-path> <new-path>",
      );
    }
    return withEndpoint(
      { name: "rename-folder", oldPath, newPath },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "move-folder") {
    const oldPath = rest[0];
    const newPath = rest[1];
    if (!oldPath || !newPath || rest.length !== 2) {
      throw new CliUsageError(
        "Usage: collector-cli move-folder <old-path> <new-path> " +
          "(alias of rename-folder; same host rename path)",
      );
    }
    return withEndpoint(
      { name: "move-folder", oldPath, newPath },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "delete-folder") {
    const folderPath = rest.join(" ").trim();
    if (!folderPath) {
      throw new CliUsageError("Usage: collector-cli delete-folder <path>");
    }
    return withEndpoint(
      { name: "delete-folder", folderPath },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "move-item") {
    const itemId = rest[0];
    const folderPath = readOpt(argv, "--folder");
    if (!itemId || rest.length !== 1 || folderPath === undefined) {
      throw new CliUsageError(
        "Usage: collector-cli move-item <item-id> --folder <path> " +
          "(alias of update-item --folder; same host move path)",
      );
    }
    return withEndpoint(
      { name: "move-item", itemId, folderPath },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "list-item-media") {
    const itemId = rest[0];
    if (!itemId || rest.length !== 1) {
      throw new CliUsageError("Usage: collector-cli list-item-media <item-id>");
    }
    return withEndpoint(
      { name: "list-item-media", itemId },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "attach-media") {
    const itemId = rest[0];
    const filePath = readOpt(argv, "--file");
    const filename = readOpt(argv, "--filename");
    if (!itemId || rest.length !== 1 || filePath === undefined) {
      throw new CliUsageError(
        "Usage: collector-cli attach-media <item-id> --file <path> [--filename <name>]",
      );
    }
    return withEndpoint(
      {
        name: "attach-media",
        itemId,
        filePath,
        ...(filename === undefined ? {} : { filename }),
      },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "replace-media") {
    const itemId = rest[0];
    const mediaId = rest[1];
    const filePath = readOpt(argv, "--file");
    const filename = readOpt(argv, "--filename");
    if (!itemId || !mediaId || rest.length !== 2 || filePath === undefined) {
      throw new CliUsageError(
        "Usage: collector-cli replace-media <item-id> <media-id> --file <path> [--filename <name>]",
      );
    }
    return withEndpoint(
      {
        name: "replace-media",
        itemId,
        mediaId,
        filePath,
        ...(filename === undefined ? {} : { filename }),
      },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "delete-media") {
    const itemId = rest[0];
    const mediaId = rest[1];
    if (!itemId || !mediaId || rest.length !== 2) {
      throw new CliUsageError(
        "Usage: collector-cli delete-media <item-id> <media-id>",
      );
    }
    return withEndpoint(
      { name: "delete-media", itemId, mediaId },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  if (command === "set-item-cover") {
    const itemId = rest[0];
    const mediaId = rest[1];
    if (!itemId || !mediaId || rest.length !== 2) {
      throw new CliUsageError(
        "Usage: collector-cli set-item-cover <item-id> <media-id>",
      );
    }
    return withEndpoint(
      { name: "set-item-cover", itemId, mediaId },
      dataDir,
      ipcPath,
      resolvedToken,
    );
  }

  throw new CliUsageError(`Unknown command: ${command}`);
}
