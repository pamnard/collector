/**
 * @collector/mcp — MCP adapter over Collector service IPC (#174).
 */

export {
  createCollectorMcpServer,
} from "./server.js";
export {
  McpEndpointError,
  parseMcpEndpointArgs,
  resolveMcpIpcPath,
} from "./endpoint.js";
