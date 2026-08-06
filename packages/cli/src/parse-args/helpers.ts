import type { ContentType } from "@collector/shared";
import { CONTENT_TYPES } from "@collector/shared";
import { CliUsageError, type CliCommand, type ParsedCliArgs } from "./types.js";

export const ENDPOINT_FLAGS = new Set([
  "--base-url",
  "--data-dir",
  "--token",
]);

export function readOpt(argv: string[], name: string): string | undefined {
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
export function readOptAllowLeadingDash(
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

export function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export function stripKnownOpts(argv: string[], flags: Set<string>): string[] {
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

export function parseContentType(raw: string | undefined): ContentType {
  const value = raw ?? "note";
  if (!(CONTENT_TYPES as readonly string[]).includes(value)) {
    throw new CliUsageError(
      `Invalid --type ${value}; expected one of ${CONTENT_TYPES.join("|")}`,
    );
  }
  return value as ContentType;
}

/** Comma-separated tag names; empty string → []. */
export function parseTagNames(raw: string): string[] {
  if (raw.trim() === "") {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function withEndpoint(
  command: CliCommand,
  baseUrl: string,
  dataDir: string | undefined,
  token: string | undefined,
): ParsedCliArgs {
  return {
    command,
    baseUrl,
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(token === undefined ? {} : { token }),
  };
}

export function unionFlagSets(...sets: Set<string>[]): Set<string> {
  const out = new Set<string>();
  for (const set of sets) {
    for (const flag of set) {
      out.add(flag);
    }
  }
  return out;
}
