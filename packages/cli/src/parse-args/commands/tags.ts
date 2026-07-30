import { readOpt } from "../helpers.js";
import { CliUsageError, type CliCommand } from "../types.js";

export const CREATE_TAG_FLAGS = new Set(["--name", "--color"]);

export function parseCreateTag(argv: string[], rest: string[]): CliCommand {
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
  return {
    name: "create-tag",
    tagName,
    ...(color === undefined ? {} : { color }),
  };
}

export function parseDeleteTag(_argv: string[], rest: string[]): CliCommand {
  const tagId = rest[0];
  if (!tagId || rest.length !== 1) {
    throw new CliUsageError("Usage: collector-cli delete-tag <tag-id>");
  }
  return { name: "delete-tag", tagId };
}
