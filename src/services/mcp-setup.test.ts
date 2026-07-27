import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const isTauri = vi.fn(() => false);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => isTauri(),
}));

import {
  buildMcpClientConfigJson,
  getMcpStdioCommand,
  MCP_COMMAND_PLACEHOLDER,
  MCP_DATA_DIR_PLACEHOLDER,
} from "./mcp-setup";

describe("buildMcpClientConfigJson", () => {
  it("builds stdio mcpServers config with live paths", () => {
    expect(
      buildMcpClientConfigJson({
        command: "/opt/Collector/resources/collector-service-host/collector-mcp",
        dataDir: "/var/lib/collector/data",
      }),
    ).toBe(`{
    "mcpServers": {
        "collector": {
            "command": "/opt/Collector/resources/collector-service-host/collector-mcp",
            "args": [
                "--data-dir",
                "/var/lib/collector/data"
            ]
        }
    }
}
`);
  });

  it("uses placeholders when command or dataDir are missing", () => {
    expect(buildMcpClientConfigJson({})).toBe(`{
    "mcpServers": {
        "collector": {
            "command": "${MCP_COMMAND_PLACEHOLDER}",
            "args": [
                "--data-dir",
                "${MCP_DATA_DIR_PLACEHOLDER}"
            ]
        }
    }
}
`);
  });

  it("mixes live command with data-dir placeholder", () => {
    const json = buildMcpClientConfigJson({
      command: "/opt/Collector/resources/collector-service-host/collector-mcp",
      dataDir: null,
    });
    expect(json).toContain(
      "/opt/Collector/resources/collector-service-host/collector-mcp",
    );
    expect(json).toContain(MCP_DATA_DIR_PLACEHOLDER);
  });
});

describe("getMcpStdioCommand", () => {
  beforeEach(() => {
    invoke.mockReset();
    isTauri.mockReset();
  });

  it("returns null outside Tauri", async () => {
    isTauri.mockReturnValue(false);
    await expect(getMcpStdioCommand()).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes get_mcp_stdio_command in Tauri", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(
      "/opt/Collector/resources/collector-service-host/collector-mcp",
    );
    await expect(getMcpStdioCommand()).resolves.toBe(
      "/opt/Collector/resources/collector-service-host/collector-mcp",
    );
    expect(invoke).toHaveBeenCalledWith("get_mcp_stdio_command");
  });
});
