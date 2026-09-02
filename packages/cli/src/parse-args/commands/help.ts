/**
 * CLI help text derived from the command registry (#843).
 * Meta only — never dials the host.
 */

import { stripKnownOpts } from "../helpers.js";
import { CliUsageError } from "../types.js";
import {
  ALL_COMMAND_FLAGS,
  COMMAND_PARSERS,
  isRegisteredCommand,
  type RegisteredCommandName,
} from "./registry.js";

/** One usage line per registered subcommand — keys must match `COMMAND_PARSERS`. */
export const COMMAND_USAGE = {
  health: "Usage: collector-cli health",
  search: "Usage: collector-cli search <query>",
  "get-item": "Usage: collector-cli get-item <item-id>",
  "get-item-source": "Usage: collector-cli get-item-source <item-id>",
  "create-item":
    "Usage: collector-cli create-item --title <title> [--type note|…] [--content …] [--url …] [--folder …] [--description …]",
  "update-item":
    "Usage: collector-cli update-item <item-id> [--title …] [--content …] [--url …] [--type …] [--tags name,…] [--folder …] [--description …]",
  "update-item-source":
    "Usage: collector-cli update-item-source <item-id> --content <raw-markdown>",
  "delete-item": "Usage: collector-cli delete-item <item-id>",
  "import-folder":
    "Usage: collector-cli import-folder --path <abs-dir> [--folder <vault-folder>] [--wait]",
  "wait-derived":
    "Usage: collector-cli wait-derived <item-id> --revision <n> [--timeout-ms <ms>]",
  "create-folder": "Usage: collector-cli create-folder <path>",
  "list-folders": "Usage: collector-cli list-folders",
  "list-folder-items":
    "Usage: collector-cli list-folder-items <path> " +
    "[--sort title|created_at|updated_at|content_type|word_count|character_count] " +
    "[--dir asc|desc]",
  "rename-folder":
    "Usage: collector-cli rename-folder <old-path> <new-path>",
  "move-folder":
    "Usage: collector-cli move-folder <old-path> <new-path> " +
    "(alias of rename-folder; same host rename path)",
  "delete-folder": "Usage: collector-cli delete-folder <path>",
  "move-item":
    "Usage: collector-cli move-item <item-id> --folder <path> " +
    "(alias of update-item --folder; same host move path)",
  "list-item-media": "Usage: collector-cli list-item-media <item-id>",
  "attach-media":
    "Usage: collector-cli attach-media <item-id> --file <path> [--filename <name>]",
  "replace-media":
    "Usage: collector-cli replace-media <item-id> <media-id> --file <path> [--filename <name>]",
  "delete-media": "Usage: collector-cli delete-media <item-id> <media-id>",
  "set-item-cover": "Usage: collector-cli set-item-cover <item-id> <media-id>",
  "discover-extract-candidates":
    "Usage: collector-cli discover-extract-candidates <item-id>  (host-specific plugins only, e.g. Instagram; not a general web clipper)",
  "extract-item-candidate":
    "Usage: collector-cli extract-item-candidate <item-id> --extractor-id <id> --url <url> [--meta '{...}']  (host-specific plugins only; candidate from discover)",
} as const satisfies Record<RegisteredCommandName, string>;

const HELP_FLAGS = new Set(["--help", "-h"]);

export function formatCommandHelp(name: RegisteredCommandName): string {
  return COMMAND_USAGE[name];
}

export function formatTopLevelHelp(): string {
  const commands = (Object.keys(COMMAND_PARSERS) as RegisteredCommandName[])
    .sort()
    .map((name) => `  ${COMMAND_USAGE[name].replace(/^Usage: collector-cli /, "")}`)
    .join("\n");

  return [
    "Usage: collector-cli (--base-url <url> | --data-dir <dir>) [--token <secret>] <command> …",
    "",
    "Dial / auth flags:",
    "  --base-url <url>   Service HTTP base URL (or COLLECTOR_SERVICE_BASE_URL)",
    "  --data-dir <dir>   Data directory for baseUrl / token files (or COLLECTOR_DATA_DIR)",
    "  --token <secret>   Host token (or COLLECTOR_HOST_TOKEN / token file under --data-dir)",
    "",
    "Commands:",
    commands,
    "",
    "Help:",
    "  collector-cli help",
    "  collector-cli help <command>",
    "  collector-cli <command> --help",
  ].join("\n");
}

/**
 * If argv requests help, return the help text.
 * Otherwise undefined (caller continues to normal parse / dial).
 */
export function tryParseCliHelp(argv: string[]): string | undefined {
  const wantsFlagHelp = argv.some((arg) => HELP_FLAGS.has(arg));
  const positional = stripKnownOpts(argv, ALL_COMMAND_FLAGS).filter(
    (arg) => !HELP_FLAGS.has(arg),
  );

  let topic: string | undefined;
  if (positional[0] === "help") {
    topic = positional[1];
  } else if (wantsFlagHelp) {
    topic = positional[0];
  } else {
    return undefined;
  }

  if (topic === undefined) {
    return formatTopLevelHelp();
  }
  if (!isRegisteredCommand(topic)) {
    throw new CliUsageError(`Unknown command: ${topic}`);
  }
  return formatCommandHelp(topic);
}
