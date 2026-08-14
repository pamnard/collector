/**
 * Resolve domain-host HTTP endpoint for MCP (#556 / #550 F).
 *
 * baseUrl from --base-url / COLLECTOR_SERVICE_BASE_URL / data-dir baseUrl file.
 * Token from --token / COLLECTOR_HOST_TOKEN or the host token file under --data-dir.
 */

import {
  defaultServiceHostTokenPath,
  resolveServiceHostBaseUrl,
  resolveServiceHostToken,
  SERVICE_HOST_TOKEN_ENV,
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
  const token = read("--token") ?? envPath(SERVICE_HOST_TOKEN_ENV);
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
  let baseUrl: string;
  try {
    baseUrl = await resolveServiceHostBaseUrl({
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new McpEndpointError(message);
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
      `Host token required: --token / ${SERVICE_HOST_TOKEN_ENV} or --data-dir / COLLECTOR_DATA_DIR (token file)`,
    );
  }

  const dataDir = options.dataDir.trim();
  try {
    const token = await resolveServiceHostToken({
      dataDir,
      ...(options.token === undefined ? {} : { token: options.token }),
    });
    return { baseUrl, token, dataDir };
  } catch (error) {
    const tokenPath = defaultServiceHostTokenPath(dataDir);
    const message = error instanceof Error ? error.message : String(error);
    throw new McpEndpointError(
      `Host token file missing or unreadable (${tokenPath}): ${message}`,
    );
  }
}
