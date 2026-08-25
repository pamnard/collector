/**
 * @collector/mcp — MCP adapter over the living domain host (#174/#556).
 */

export {
  createCollectorMcpServer,
} from "./server.js";
export {
  McpEndpointError,
  parseMcpEndpointArgs,
  resolveMcpHostEndpoint,
  type McpHostEndpoint,
  type ParsedMcpEndpointArgs,
} from "./endpoint.js";
export {
  createMcpHostSession,
  createStaticMcpHostSession,
  type McpHostSession,
} from "./host-session.js";
export { runCollectorMcp, type RunCollectorMcpIo } from "./run.js";
