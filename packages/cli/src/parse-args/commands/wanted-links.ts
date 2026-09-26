import { SEARCH_PAGE_SIZE } from "@collector/service";
import { readOpt } from "../helpers.js";
import { CliUsageError, type CliCommand } from "../types.js";

export const WANTED_LINK_TARGETS_FLAGS = new Set([
  "--limit",
  "--offset",
  "--sort",
  "--dir",
]);

export const WANTED_LINK_TARGET_SOURCES_FLAGS = new Set([
  "--target",
  "--status",
  "--limit",
  "--offset",
]);

const TARGETS_USAGE =
  "Usage: collector-cli wanted-link-targets " +
  "[--limit N] [--offset N] " +
  "[--sort source_count|raw_target] [--dir asc|desc]";

const SOURCES_USAGE =
  "Usage: collector-cli wanted-link-target-sources " +
  "--target <raw> --status unresolved|ambiguous " +
  "[--limit N] [--offset N]";

function parseNonNegInt(
  raw: string | undefined,
  flag: string,
  fallback: number,
): number {
  if (raw === undefined) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new CliUsageError(`Invalid ${flag} ${raw}; expected non-negative integer`);
  }
  return n;
}

function parsePositiveInt(
  raw: string | undefined,
  flag: string,
  fallback: number,
): number {
  if (raw === undefined) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new CliUsageError(`Invalid ${flag} ${raw}; expected positive integer`);
  }
  return n;
}

export function parseWantedLinkTargets(
  argv: string[],
  rest: string[],
): CliCommand {
  if (rest.length !== 0) {
    throw new CliUsageError(TARGETS_USAGE);
  }
  const limit = parsePositiveInt(
    readOpt(argv, "--limit"),
    "--limit",
    SEARCH_PAGE_SIZE,
  );
  const offset = parseNonNegInt(readOpt(argv, "--offset"), "--offset", 0);
  const sortKey = readOpt(argv, "--sort");
  const sortDir = readOpt(argv, "--dir");
  if (sortKey === undefined && sortDir === undefined) {
    return {
      name: "wanted-link-targets",
      limit,
      offset,
      sort: { key: "source_count", dir: "desc" },
    };
  }
  if (sortKey === undefined || sortDir === undefined) {
    throw new CliUsageError(
      `${TARGETS_USAGE} (--sort and --dir must be used together)`,
    );
  }
  if (sortKey !== "source_count" && sortKey !== "raw_target") {
    throw new CliUsageError(
      `Invalid --sort ${sortKey}; expected source_count|raw_target`,
    );
  }
  if (sortDir !== "asc" && sortDir !== "desc") {
    throw new CliUsageError(`Invalid --dir ${sortDir}; expected asc|desc`);
  }
  return {
    name: "wanted-link-targets",
    limit,
    offset,
    sort: { key: sortKey, dir: sortDir },
  };
}

export function parseWantedLinkTargetSources(
  argv: string[],
  rest: string[],
): CliCommand {
  if (rest.length !== 0) {
    throw new CliUsageError(SOURCES_USAGE);
  }
  const rawTarget = readOpt(argv, "--target");
  const resolveStatus = readOpt(argv, "--status");
  if (!rawTarget || !resolveStatus) {
    throw new CliUsageError(SOURCES_USAGE);
  }
  if (resolveStatus !== "unresolved" && resolveStatus !== "ambiguous") {
    throw new CliUsageError(
      `Invalid --status ${resolveStatus}; expected unresolved|ambiguous`,
    );
  }
  const limitRaw = readOpt(argv, "--limit");
  const offsetRaw = readOpt(argv, "--offset");
  if (limitRaw === undefined && offsetRaw === undefined) {
    return {
      name: "wanted-link-target-sources",
      rawTarget,
      resolveStatus,
    };
  }
  return {
    name: "wanted-link-target-sources",
    rawTarget,
    resolveStatus,
    limit: parsePositiveInt(limitRaw, "--limit", 100),
    offset: parseNonNegInt(offsetRaw, "--offset", 0),
  };
}
