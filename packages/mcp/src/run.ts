/**
 * `collector-mcp` — stdio MCP over the living domain host HTTP API (#556).
 * Never opens SQLite; dials an already-running host only.
 */

import {
  createCollectorHostServiceClient,
  createHttpHostTransport,
} from "@collector/client";
import { isHostWireError } from "@collector/service/host";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  McpEndpointError,
  parseMcpEndpointArgs,
  resolveMcpHostEndpoint,
} from "./endpoint.js";
import { createCollectorMcpServer } from "./server.js";

export type RunCollectorMcpIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function formatConnectFailure(error: unknown, baseUrl: string): string {
  if (
    isHostWireError(error) &&
    (error.code === "not_connected" ||
      error.code === "token_missing" ||
      error.code === "auth_failed")
  ) {
    return `Collector service is not running or auth failed (${baseUrl}): ${error.message}`;
  }
  if (error instanceof Error) {
    return `Failed to reach Collector service at ${baseUrl}: ${error.message}`;
  }
  return `Failed to reach Collector service at ${baseUrl}`;
}

/**
 * Parse args, dial the living host over HTTP, attach stdio MCP transport.
 * Returns process exit code (0 = connected and serving; non-zero = failure).
 */
export async function runCollectorMcp(
  argv: string[],
  io: RunCollectorMcpIo = {
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  },
): Promise<number> {
  let endpoint: Awaited<ReturnType<typeof resolveMcpHostEndpoint>>;
  try {
    const parsed = parseMcpEndpointArgs(argv);
    endpoint = await resolveMcpHostEndpoint(parsed);
  } catch (error) {
    const message =
      error instanceof McpEndpointError ? error.message : String(error);
    io.stderr(message);
    return 2;
  }

  let client;
  try {
    const transport = await createHttpHostTransport({
      baseUrl: endpoint.baseUrl,
      token: endpoint.token,
      connectTimeoutMs: 2_000,
    });
    client = createCollectorHostServiceClient(transport);
  } catch (error) {
    io.stderr(formatConnectFailure(error, endpoint.baseUrl));
    return 1;
  }

  const server = createCollectorMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return 0;
}
