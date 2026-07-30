import { readOpt } from "../helpers.js";
import { CliUsageError, type CliCommand } from "../types.js";

export const ATTACH_MEDIA_FLAGS = new Set(["--file", "--filename"]);
export const REPLACE_MEDIA_FLAGS = new Set(["--file", "--filename"]);

export function parseListItemMedia(_argv: string[], rest: string[]): CliCommand {
  const itemId = rest[0];
  if (!itemId || rest.length !== 1) {
    throw new CliUsageError("Usage: collector-cli list-item-media <item-id>");
  }
  return { name: "list-item-media", itemId };
}

export function parseAttachMedia(argv: string[], rest: string[]): CliCommand {
  const itemId = rest[0];
  const filePath = readOpt(argv, "--file");
  const filename = readOpt(argv, "--filename");
  if (!itemId || rest.length !== 1 || filePath === undefined) {
    throw new CliUsageError(
      "Usage: collector-cli attach-media <item-id> --file <path> [--filename <name>]",
    );
  }
  return {
    name: "attach-media",
    itemId,
    filePath,
    ...(filename === undefined ? {} : { filename }),
  };
}

export function parseReplaceMedia(argv: string[], rest: string[]): CliCommand {
  const itemId = rest[0];
  const mediaId = rest[1];
  const filePath = readOpt(argv, "--file");
  const filename = readOpt(argv, "--filename");
  if (!itemId || !mediaId || rest.length !== 2 || filePath === undefined) {
    throw new CliUsageError(
      "Usage: collector-cli replace-media <item-id> <media-id> --file <path> [--filename <name>]",
    );
  }
  return {
    name: "replace-media",
    itemId,
    mediaId,
    filePath,
    ...(filename === undefined ? {} : { filename }),
  };
}

export function parseDeleteMedia(_argv: string[], rest: string[]): CliCommand {
  const itemId = rest[0];
  const mediaId = rest[1];
  if (!itemId || !mediaId || rest.length !== 2) {
    throw new CliUsageError(
      "Usage: collector-cli delete-media <item-id> <media-id>",
    );
  }
  return { name: "delete-media", itemId, mediaId };
}

export function parseSetItemCover(_argv: string[], rest: string[]): CliCommand {
  const itemId = rest[0];
  const mediaId = rest[1];
  if (!itemId || !mediaId || rest.length !== 2) {
    throw new CliUsageError(
      "Usage: collector-cli set-item-cover <item-id> <media-id>",
    );
  }
  return { name: "set-item-cover", itemId, mediaId };
}
