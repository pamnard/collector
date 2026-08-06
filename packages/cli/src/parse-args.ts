/**
 * Minimal argv parser for the Collector CLI (#172/#173 / #550 G).
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

function envPath(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  if (argv.includes("--ipc-path")) {
    throw new CliUsageError(
      "--ipc-path is removed; use --base-url / COLLECTOR_SERVICE_BASE_URL",
    );
  }
  const baseUrl = readOpt(argv, "--base-url") ?? envPath("COLLECTOR_SERVICE_BASE_URL");
  const dataDir = readOpt(argv, "--data-dir") ?? envPath("COLLECTOR_DATA_DIR");
  const tokenFlag = readOpt(argv, "--token");
  const tokenEnv = process.env.COLLECTOR_HOST_TOKEN?.trim();
  const resolvedToken =
    tokenFlag ??
    (tokenEnv !== undefined && tokenEnv.length > 0 ? tokenEnv : undefined);
  if (baseUrl === undefined) {
    throw new CliUsageError(
      "Host endpoint required: --base-url <url> or COLLECTOR_SERVICE_BASE_URL",
    );
  }

  const positional = stripKnownOpts(argv, ALL_COMMAND_FLAGS);
  const [command, ...rest] = positional;
  if (command === undefined) {
    throw new CliUsageError(
      "Usage: collector-cli --base-url <url> [--data-dir <dir>] [--token <secret>] <command> …",
    );
  }

  const parse = COMMAND_PARSERS[command];
  if (parse === undefined) {
    throw new CliUsageError(`Unknown command: ${command}`);
  }

  return withEndpoint(parse(argv, rest), baseUrl, dataDir, resolvedToken);
}
