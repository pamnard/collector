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

  it("create/update/delete item via IPC (#173)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-cli-write-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });

    const createdOut: string[] = [];
    const createCode = await runCollectorCli(
      [
        "--data-dir",
        dataDir,
        "create-item",
        "--title",
        "CLI note",
        "--type",
        "note",
        "--content",
        "hello from cli",
      ],
      {
        stdout: (line) => createdOut.push(line),
        stderr: (line) => createdOut.push(`ERR:${line}`),
      },
    );
    expect(createCode).toBe(0);
    const created = JSON.parse(createdOut.join("\n")) as { id: string; title: string };
    expect(created.title).toBe("CLI note");
    expect(created.id).toBeTruthy();

    const updatedOut: string[] = [];
    const updateCode = await runCollectorCli(
      [
        "--data-dir",
        dataDir,
        "update-item",
        created.id,
        "--title",
        "CLI note edited",
      ],
      {
        stdout: (line) => updatedOut.push(line),
        stderr: (line) => updatedOut.push(`ERR:${line}`),
      },
    );
    expect(updateCode).toBe(0);
    expect(JSON.parse(updatedOut.join("\n")).title).toBe("CLI note edited");

    const folderOut: string[] = [];
    const folderCode = await runCollectorCli(
      ["--data-dir", dataDir, "create-folder", "Inbox"],
      {
        stdout: (line) => folderOut.push(line),
        stderr: (line) => folderOut.push(`ERR:${line}`),
      },
    );
    expect(folderCode).toBe(0);

    const moveCode = await runCollectorCli(
      ["--data-dir", dataDir, "move-item", created.id, "--folder", "Inbox"],
      {
        stdout: () => {},
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(moveCode).toBe(0);

    const deleteCode = await runCollectorCli(
      ["--data-dir", dataDir, "delete-item", created.id],
      {
        stdout: () => {},
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(deleteCode).toBe(0);

    const refuse: string[] = [];
    const refuseCode = await runCollectorCli(
      [
        "--ipc-path",
        defaultServiceIpcPath(dataDir) + ".missing",
        "create-item",
        "--title",
        "nope",
      ],
      {
        stdout: () => {},
        stderr: (line) => refuse.push(line),
      },
    );
    expect(refuseCode).toBe(1);
    expect(refuse.join("\n")).toMatch(/not running|not_connected|IPC connect failed/i);

    await host.close();
  });
});
