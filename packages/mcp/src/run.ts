/**
 * `collector-mcp` — stdio MCP over the living domain host HTTP API (#556).
 * Never opens SQLite; dials an already-running host only.
 */

import { formatHostConnectFailure } from "@collector/service/host";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  McpEndpointError,
  parseMcpEndpointArgs,
} from "./endpoint.js";
import { createMcpHostSession } from "./host-session.js";
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
  let parsed: ReturnType<typeof parseMcpEndpointArgs>;
  try {
    parsed = parseMcpEndpointArgs(argv);
  } catch (error) {
    const message =
      error instanceof McpEndpointError ? error.message : String(error);
    io.stderr(message);
    return 2;
  }

  let session;
  try {
    session = await createMcpHostSession(parsed);
  } catch (error) {
    if (error instanceof McpEndpointError) {
      io.stderr(error.message);
      return 2;
    }
    const endpointLabel =
      parsed.baseUrl?.trim() ||
      parsed.dataDir?.trim() ||
      "Collector host";
    io.stderr(formatHostConnectFailure(error, endpointLabel));
    return 1;
  }

  const server = createCollectorMcpServer(session);
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  return 0;
}
