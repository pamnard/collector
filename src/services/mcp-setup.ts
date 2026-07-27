/**
 * Settings → MCP setup helpers (#273).
 *
 * Packaged `collector-mcp` path comes from Tauri; data-dir from the service.
 * Missing values become placeholders so JSON is always copyable (incl. webdev).
 */

import { invoke, isTauri } from "@tauri-apps/api/core";

export const MCP_COMMAND_PLACEHOLDER = "__COLLECTOR_MCP_COMMAND__";
export const MCP_DATA_DIR_PLACEHOLDER = "__COLLECTOR_DATA_DIR__";

export async function getMcpStdioCommand(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  return invoke<string | null>("get_mcp_stdio_command");
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
