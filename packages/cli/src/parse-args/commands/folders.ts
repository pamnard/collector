import { CliUsageError, type CliCommand } from "../types.js";

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
