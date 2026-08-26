import { hasFlag, readOpt } from "../helpers.js";
import { CliUsageError, type CliCommand } from "../types.js";

export const EXTRACT_ITEM_CANDIDATE_FLAGS = new Set([
  "--extractor-id",
  "--url",
  "--meta",
]);

export function parseDiscoverExtractCandidates(
  _argv: string[],
  rest: string[],
): CliCommand {
  const itemId = rest[0];
  if (!itemId || rest.length !== 1) {
    throw new CliUsageError(
      "Usage: collector-cli discover-extract-candidates <item-id>",
    );
  }
  return { name: "discover-extract-candidates", itemId };
}

function parseMetaJson(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliUsageError(
      "extract-item-candidate --meta must be a JSON object of string values",
    );
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new CliUsageError(
      "extract-item-candidate --meta must be a JSON object of string values",
    );
  }
  const meta: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (typeof value !== "string") {
      throw new CliUsageError(
        "extract-item-candidate --meta must be a JSON object of string values",
      );
    }
    meta[key] = value;
  }
  return meta;
}

export function parseExtractItemCandidate(
  argv: string[],
  rest: string[],
): CliCommand {
  const itemId = rest[0];
  if (!itemId || rest.length !== 1) {
    throw new CliUsageError(
      "Usage: collector-cli extract-item-candidate <item-id> --extractor-id <id> --url <url> [--meta '{...}']",
    );
  }
  const extractorId = readOpt(argv, "--extractor-id");
  const url = readOpt(argv, "--url");
  if (!extractorId || !url) {
    throw new CliUsageError(
      "extract-item-candidate requires --extractor-id and --url",
    );
  }
  const metaRaw = hasFlag(argv, "--meta") ? readOpt(argv, "--meta") : undefined;
  if (hasFlag(argv, "--meta") && metaRaw === undefined) {
    throw new CliUsageError("extract-item-candidate --meta requires a JSON value");
  }
  const meta = metaRaw === undefined ? undefined : parseMetaJson(metaRaw);
  return {
    name: "extract-item-candidate",
    itemId,
    extractorId,
    url,
    ...(meta === undefined ? {} : { meta }),
  };
}
