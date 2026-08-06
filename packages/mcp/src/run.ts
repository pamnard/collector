/**
 * `collector-mcp` — stdio MCP over the living domain host HTTP API (#556).
 * Never opens SQLite; dials an already-running host only.
 */

import {
  createCollectorHostServiceClient,
  createHttpHostTransport,
} from "@collector/client";
import { formatHostConnectFailure } from "@collector/service/host";
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
    io.stderr(formatHostConnectFailure(error, endpoint.baseUrl));
    return 1;
  }

  const server = createCollectorMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return 0;
}
