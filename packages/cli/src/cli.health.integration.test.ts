import { describe, expect, it } from "vitest";
import { startServiceHost } from "@collector/service/host";
import { cliArgs, useTempDataDirs } from "./cli-integration-test-harness.js";
import { runCollectorCli } from "./run.js";

describe("collector CLI health (#172 / #550 G / #922)", () => {
  const { mktemp } = useTempDataDirs();

  it("health succeeds against a live host; fails clearly when absent", async () => {
    const dataDir = mktemp("collector-cli-");
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    const lines: string[] = [];
    const code = await runCollectorCli(cliArgs(host, dataDir, "health"), {
      stdout: (line) => lines.push(line),
      stderr: (line) => lines.push(`ERR:${line}`),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/"ok"\s*:\s*true/);
    const deadBaseUrl = host.baseUrl;
    await host.close();

    const err: string[] = [];
    const missing = await runCollectorCli(
      ["--base-url", deadBaseUrl, "--token", "unused", "health"],
      {
        stdout: () => {},
        stderr: (line) => err.push(line),
      },
    );
    expect(missing).toBe(1);
    expect(err.join("\n")).toMatch(
      /not running|not_connected|Failed to reach|token file missing/i,
    );
  });
});
