/**
 * Resolve domain-host HTTP endpoint for MCP (#556).
 *
 * Requires baseUrl (flag/env). Token from --token / COLLECTOR_SERVICE_TOKEN
 * or the host token file under --data-dir.
 */

import {
  defaultServiceIpcTokenPath,
  readServiceIpcTokenFile,
} from "@collector/service/host";

export class McpEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpEndpointError";
  }
}

export type ParsedMcpEndpointArgs = {
  baseUrl?: string;
  dataDir?: string;
  token?: string;
};

export type McpHostEndpoint = {
  baseUrl: string;
  token: string;
  dataDir?: string;
};

function envPath(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}

export function parseMcpEndpointArgs(argv: string[]): ParsedMcpEndpointArgs {
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
  const baseUrl = read("--base-url") ?? envPath("COLLECTOR_SERVICE_BASE_URL");
  const dataDir = read("--data-dir") ?? envPath("COLLECTOR_DATA_DIR");
  const token = read("--token") ?? envPath("COLLECTOR_SERVICE_TOKEN");
  return {
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(token === undefined ? {} : { token }),
  };
}

/**
 * Resolve baseUrl + host token for dialing the living domain host.
 */
export async function resolveMcpHostEndpoint(
  options: ParsedMcpEndpointArgs,
): Promise<McpHostEndpoint> {
  const baseUrl = options.baseUrl?.trim();
  if (!baseUrl) {
    throw new McpEndpointError(
      "Host endpoint required: --base-url / COLLECTOR_SERVICE_BASE_URL",
    );
  }

  if (options.token !== undefined && options.token.trim() !== "") {
    return {
      baseUrl,
      token: options.token.trim(),
      ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    };
  }

  if (options.dataDir === undefined || options.dataDir.trim() === "") {
    throw new McpEndpointError(
      "Host token required: --token / COLLECTOR_SERVICE_TOKEN or --data-dir / COLLECTOR_DATA_DIR (token file)",
    );
  }

  const dataDir = options.dataDir.trim();
  const tokenPath = defaultServiceIpcTokenPath(dataDir);
  try {
    const token = await readServiceIpcTokenFile(tokenPath);
    return { baseUrl, token, dataDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new McpEndpointError(
      `Host token file missing or unreadable (${tokenPath}): ${message}`,
    );
  }
}
