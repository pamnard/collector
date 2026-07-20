/**
 * Resolve local service IPC endpoint for MCP (#174).
 */

import { defaultServiceIpcPath } from "@collector/service/host";

export class McpEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpEndpointError";
  }
}

export function resolveMcpIpcPath(options: {
  dataDir?: string;
  ipcPath?: string;
}): string {
  if (options.dataDir !== undefined && options.ipcPath !== undefined) {
    throw new McpEndpointError("Pass only one of dataDir or ipcPath");
  }
  if (options.ipcPath !== undefined) {
    return options.ipcPath;
  }
  if (options.dataDir !== undefined) {
    return defaultServiceIpcPath(options.dataDir);
  }
  throw new McpEndpointError(
    "Service endpoint required: --data-dir / COLLECTOR_DATA_DIR or --ipc-path / COLLECTOR_IPC_PATH",
  );
}

function envPath(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}

export function parseMcpEndpointArgs(argv: string[]): {
  dataDir?: string;
  ipcPath?: string;
} {
  const read = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    if (idx < 0) {
      return undefined;
    }
    const value = argv[idx + 1];
    if (value === undefined || value.startsWith("-")) {
      throw new McpEndpointError(`Missing value for ${name}`);
    }
    return value;
  };
  const dataDir = read("--data-dir") ?? envPath("COLLECTOR_DATA_DIR");
  const ipcPath = read("--ipc-path") ?? envPath("COLLECTOR_IPC_PATH");
  return {
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(ipcPath === undefined ? {} : { ipcPath }),
  };
}
