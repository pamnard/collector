import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  startServiceHost,
  defaultServiceIpcPath,
} from "@collector/service/host";
import { runCollectorCli } from "./run.js";

describe("collector CLI IPC (#172)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("health succeeds against a live host; fails clearly when absent", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-cli-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    const lines: string[] = [];
    const code = await runCollectorCli(["--data-dir", dataDir, "health"], {
      stdout: (line) => lines.push(line),
      stderr: (line) => lines.push(`ERR:${line}`),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/"ok"\s*:\s*true/);
    await host.close();

    const err: string[] = [];
    const missing = await runCollectorCli(
      ["--ipc-path", defaultServiceIpcPath(dataDir), "health"],
      {
        stdout: () => {},
        stderr: (line) => err.push(line),
      },
    );
    expect(missing).toBe(1);
    expect(err.join("\n")).toMatch(/not running|not_connected|IPC connect failed/i);
  });

  it("search and get-item round-trip via IPC (empty vault)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-cli-rw-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    const out: string[] = [];
    const searchCode = await runCollectorCli(
      ["--data-dir", dataDir, "search", "nothing-matches"],
      {
        stdout: (line) => out.push(line),
        stderr: (line) => out.push(`ERR:${line}`),
      },
    );
    expect(searchCode).toBe(0);
    expect(JSON.parse(out.join("\n"))).toEqual([]);

    const missing: string[] = [];
    const getCode = await runCollectorCli(
      ["--data-dir", dataDir, "get-item", "missing-id"],
      {
        stdout: () => {},
        stderr: (line) => missing.push(line),
      },
    );
    expect(getCode).toBe(1);
    expect(missing.join("\n").length).toBeGreaterThan(0);
    await host.close();
  });
});
