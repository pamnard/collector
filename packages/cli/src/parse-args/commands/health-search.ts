import { CliUsageError, type CliCommand } from "../types.js";

export function parseHealth(_argv: string[], rest: string[]): CliCommand {
  if (rest.length > 0) {
    throw new CliUsageError("health takes no positional arguments");
  }
  return { name: "health" };
}

export function parseSearch(_argv: string[], rest: string[]): CliCommand {
  const query = rest.join(" ").trim();
  if (!query) {
    throw new CliUsageError("Usage: collector-cli search <query>");
  }
  return { name: "search", query };
}
