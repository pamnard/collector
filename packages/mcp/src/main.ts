#!/usr/bin/env node
/**
 * `collector-mcp` — stdio MCP server over local Collector service IPC (#174/#336).
 *
 * Usage:
 *   collector-mcp --data-dir <dir>
 *   collector-mcp --ipc-path <path>
 *   COLLECTOR_DATA_DIR=… collector-mcp
 *
 * Auth token is read from dataDir's collector-service.ipc-token (or
 * --token / COLLECTOR_IPC_TOKEN). Settings MCP JSON stays `--data-dir` only.
 */

import { connectCollectorIpcService } from "@collector/client/node";
import { isServiceIpcError } from "@collector/service/host";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  McpEndpointError,
  parseMcpEndpointArgs,
  resolveMcpIpcPath,
} from "./endpoint.js";
import { createCollectorMcpServer } from "./server.js";

async function main(): Promise<void> {
  let endpoint: ReturnType<typeof parseMcpEndpointArgs>;
  let ipcPath: string;
  try {
    endpoint = parseMcpEndpointArgs(process.argv.slice(2));
    ipcPath = resolveMcpIpcPath(endpoint);
  } catch (error) {
    const message =
      error instanceof McpEndpointError ? error.message : String(error);
    console.error(message);
    process.exit(2);
  }

  let client;
  try {
    client = await connectCollectorIpcService(ipcPath, {
      connectTimeoutMs: 2_000,
      ...(endpoint.dataDir === undefined ? {} : { dataDir: endpoint.dataDir }),
      ...(endpoint.token === undefined ? {} : { token: endpoint.token }),
    });
  } catch (error) {
    if (isServiceIpcError(error) && error.code === "not_connected") {
      console.error(
        `Collector service is not running (IPC ${ipcPath}): ${error.message}`,
      );
    } else {
      console.error(
        error instanceof Error ? error.message : String(error),
      );
    }
    process.exit(1);
  }

  const server = createCollectorMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();
