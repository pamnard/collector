/**
 * Minimal argv parser for the read-only Collector CLI (#172).
 */

export type CliCommand =
  | { name: "health" }
  | { name: "search"; query: string }
  | { name: "get-item"; itemId: string };

export interface ParsedCliArgs {
  command: CliCommand;
  dataDir?: string;
  ipcPath?: string;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

function readOpt(argv: string[], name: string): string | undefined {
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

function stripOpts(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--data-dir" || arg === "--ipc-path") {
      i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const dataDir = readOpt(argv, "--data-dir");
  const ipcPath = readOpt(argv, "--ipc-path");
  if (dataDir !== undefined && ipcPath !== undefined) {
    throw new CliUsageError("Pass only one of --data-dir or --ipc-path");
  }
  if (dataDir === undefined && ipcPath === undefined) {
    throw new CliUsageError(
      "Service endpoint required: --data-dir <path> or --ipc-path <path>",
    );
  }

  const positional = stripOpts(argv);
  const [command, ...rest] = positional;
  if (command === undefined) {
    throw new CliUsageError(
      "Usage: collector [--data-dir <dir>|--ipc-path <path>] <health|search|get-item> …",
    );
  }

  if (command === "health") {
    if (rest.length > 0) {
      throw new CliUsageError("health takes no positional arguments");
    }
    return {
      command: { name: "health" },
      ...(dataDir === undefined ? {} : { dataDir }),
      ...(ipcPath === undefined ? {} : { ipcPath }),
    };
  }

  if (command === "search") {
    const query = rest.join(" ").trim();
    if (!query) {
      throw new CliUsageError("Usage: collector search <query>");
    }
    return {
      command: { name: "search", query },
      ...(dataDir === undefined ? {} : { dataDir }),
      ...(ipcPath === undefined ? {} : { ipcPath }),
    };
  }

  if (command === "get-item") {
    const itemId = rest[0];
    if (!itemId || rest.length !== 1) {
      throw new CliUsageError("Usage: collector get-item <item-id>");
    }
    return {
      command: { name: "get-item", itemId },
      ...(dataDir === undefined ? {} : { dataDir }),
      ...(ipcPath === undefined ? {} : { ipcPath }),
    };
  }

  throw new CliUsageError(`Unknown command: ${command}`);
}
