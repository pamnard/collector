/**
 * Settings → MCP setup helpers (#273 / #555).
 *
 * Packaged `collector-mcp` path is documented in README; UI uses placeholders
 * when the install path is unknown (browser / DevMock).
 */

export const MCP_COMMAND_PLACEHOLDER = "__COLLECTOR_MCP_COMMAND__";
export const MCP_DATA_DIR_PLACEHOLDER = "__COLLECTOR_DATA_DIR__";

/** Browser UI cannot resolve the packaged MCP binary path (#555). */
export async function getMcpStdioCommand(): Promise<string | null> {
  return null;
}

export function buildMcpClientConfigJson(options: {
  command?: string | null;
  dataDir?: string | null;
} = {}): string {
  const command =
    options.command && options.command.trim()
      ? options.command.trim()
      : MCP_COMMAND_PLACEHOLDER;
  const dataDir =
    options.dataDir && options.dataDir.trim()
      ? options.dataDir.trim()
      : MCP_DATA_DIR_PLACEHOLDER;
  return `${JSON.stringify(
    {
      mcpServers: {
        collector: {
          command,
          args: ["--data-dir", dataDir],
        },
      },
    },
    null,
    4,
  )}\n`;
}
