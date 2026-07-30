/**
 * Minimal argv parser for the Collector CLI (#172/#173).
 * Thin endpoint + command dispatch (#378).
 */

import { ALL_COMMAND_FLAGS, COMMAND_PARSERS } from "./parse-args/commands/registry.js";
import {
  readOpt,
  stripKnownOpts,
  withEndpoint,
} from "./parse-args/helpers.js";
import { CliUsageError, type ParsedCliArgs } from "./parse-args/types.js";

export type { CliCommand, ParsedCliArgs } from "./parse-args/types.js";
export { CliUsageError } from "./parse-args/types.js";

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

  const positional = stripKnownOpts(argv, ALL_COMMAND_FLAGS);
  const [command, ...rest] = positional;
  if (command === undefined) {
    throw new CliUsageError(
      "Usage: collector-cli [--data-dir <dir>|--ipc-path <path>] [--token <secret>] <command> …",
    );
  }

  const parse = COMMAND_PARSERS[command];
  if (parse === undefined) {
    throw new CliUsageError(`Unknown command: ${command}`);
  }

  return withEndpoint(parse(argv, rest), dataDir, ipcPath, resolvedToken);
}
