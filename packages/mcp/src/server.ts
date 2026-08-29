/**
 * MCP tool registration over a living domain-host client (#174/#556/#826).
 * Thin adapter only — never opens SQLite.
 *
 * Tool facts (name, description, zod schema) live in `mcp-tool-defs.ts`;
 * host handlers in `mcp-tool-runs.ts`. This file zips them and registers.
 */

import type { CollectorHostServiceClient } from "@collector/client";
import { isHostWireError } from "@collector/service/host";
import {
  McpServer,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import {
  formatMcpAuthFailure,
  type McpHostSession,
} from "./host-session.js";
import {
  buildMcpToolInputSchema,
  COLLECTOR_MCP_TOOL_DEFS,
} from "./mcp-tool-defs.js";
import { COLLECTOR_MCP_TOOL_RUNS } from "./mcp-tool-runs.js";

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown, session: McpHostSession) {
  const message =
    isHostWireError(error) && error.code === "auth_failed"
      ? formatMcpAuthFailure(error, session)
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

async function runTool(
  session: McpHostSession,
  fn: (client: CollectorHostServiceClient) => Promise<unknown>,
) {
  try {
    return textResult(await session.withAuthRetry(fn));
  } catch (error) {
    return errorResult(error, session);
  }
}

/**
 * Build an MCP server whose tools call the living domain host (HTTP client).
 * Session may refresh data-dir credentials once on auth_failed (#826).
 */
export function createCollectorMcpServer(session: McpHostSession): McpServer {
  const server = new McpServer({
    name: "collector",
    version: "0.1.0",
  });

  for (const def of COLLECTOR_MCP_TOOL_DEFS) {
    const inputSchema = buildMcpToolInputSchema(def);
    const run = COLLECTOR_MCP_TOOL_RUNS[def.name];
    const handler = (async (args: Record<string, unknown>) =>
      runTool(session, (client) =>
        run(args, client),
      )) as unknown as ToolCallback<ZodRawShape>;
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema,
      },
      handler,
    );
  }

  return server;
}
