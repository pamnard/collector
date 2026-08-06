import { describe, expect, it } from "vitest";

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
        command: "/opt/Collector/collector-service-host/collector-mcp",
        dataDir: "/var/lib/collector/data",
      }),
    ).toBe(`{
    "mcpServers": {
        "collector": {
            "command": "/opt/Collector/collector-service-host/collector-mcp",
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
      command: "/opt/Collector/collector-service-host/collector-mcp",
      dataDir: null,
    });
    expect(json).toContain("/opt/Collector/collector-service-host/collector-mcp");
    expect(json).toContain(MCP_DATA_DIR_PLACEHOLDER);
  });
});

describe("getMcpStdioCommand", () => {
  it("returns null in browser UI (#555)", async () => {
    await expect(getMcpStdioCommand()).resolves.toBeNull();
  });
});
