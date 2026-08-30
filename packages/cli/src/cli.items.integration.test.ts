import { describe, expect, it } from "vitest";
import { startServiceHost } from "@collector/service/host";
import { cliArgs, useTempDataDirs } from "./cli-integration-test-harness.js";
import { runCollectorCli } from "./run.js";

describe("collector CLI items (#172 / #173 / #922)", () => {
  const { mktemp } = useTempDataDirs();

  it("search and get-item round-trip via HTTP (empty vault)", async () => {
    const dataDir = mktemp("collector-cli-rw-");
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    try {
      const out: string[] = [];
      const searchCode = await runCollectorCli(
        cliArgs(host, dataDir, "search", "nothing-matches"),
        {
          stdout: (line) => out.push(line),
          stderr: (line) => out.push(`ERR:${line}`),
        },
      );
      expect(searchCode).toBe(0);
      expect(JSON.parse(out.join("\n"))).toEqual({
        items: [],
        total: 0,
        offset: 0,
      });

      const missing: string[] = [];
      const getCode = await runCollectorCli(
        cliArgs(host, dataDir, "get-item", "missing-id"),
        {
          stdout: () => {},
          stderr: (line) => missing.push(line),
        },
      );
      expect(getCode).toBe(1);
      expect(missing.join("\n").length).toBeGreaterThan(0);
    } finally {
      await host.close();
    }
  });

  it("create/update/source/tags/delete item via HTTP (#173)", async () => {
    const dataDir = mktemp("collector-cli-write-");
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    try {
      const createdOut: string[] = [];
      const createCode = await runCollectorCli(
        cliArgs(
          host,
          dataDir,
          "create-item",
          "--title",
          "CLI note",
          "--type",
          "note",
          "--content",
          "hello from cli",
        ),
        {
          stdout: (line) => createdOut.push(line),
          stderr: (line) => createdOut.push(`ERR:${line}`),
        },
      );
      expect(createCode).toBe(0);
      const created = JSON.parse(createdOut.join("\n")) as {
        id: string;
        title: string;
      };
      expect(created.title).toBe("CLI note");
      expect(typeof created.id).toBe("string");
      expect(created.id.length).toBeGreaterThan(0);

      const updatedOut: string[] = [];
      const updateCode = await runCollectorCli(
        cliArgs(
          host,
          dataDir,
          "update-item",
          created.id,
          "--title",
          "CLI note edited",
        ),
        {
          stdout: (line) => updatedOut.push(line),
          stderr: (line) => updatedOut.push(`ERR:${line}`),
        },
      );
      expect(updateCode).toBe(0);
      expect(JSON.parse(updatedOut.join("\n")).title).toBe("CLI note edited");

      const typedOut: string[] = [];
      const typedCode = await runCollectorCli(
        cliArgs(host, dataDir, "update-item", created.id, "--type", "article"),
        {
          stdout: (line) => typedOut.push(line),
          stderr: (line) => typedOut.push(`ERR:${line}`),
        },
      );
      expect(typedCode).toBe(0);
      expect(JSON.parse(typedOut.join("\n")).content_type).toBe("article");

      const taggedOut: string[] = [];
      const taggedCode = await runCollectorCli(
        cliArgs(
          host,
          dataDir,
          "update-item",
          created.id,
          "--tags",
          "cli-351,brand-new-cli-tag",
        ),
        {
          stdout: (line) => taggedOut.push(line),
          stderr: (line) => taggedOut.push(`ERR:${line}`),
        },
      );
      expect(taggedCode).toBe(0);
      expect(JSON.parse(taggedOut.join("\n")).tag_ids).toHaveLength(2);

      const sourcePeek: string[] = [];
      const sourcePeekCode = await runCollectorCli(
        cliArgs(host, dataDir, "get-item-source", created.id),
        {
          stdout: (line) => sourcePeek.push(line),
          stderr: (line) => sourcePeek.push(`ERR:${line}`),
        },
      );
      expect(sourcePeekCode).toBe(0);
      expect(sourcePeek.join("\n")).toMatch(/brand-new-cli-tag/);
      expect(sourcePeek.join("\n")).toMatch(/cli-351/);

      const sourceOut: string[] = [];
      const sourceCode = await runCollectorCli(
        cliArgs(host, dataDir, "get-item-source", created.id),
        {
          stdout: (line) => sourceOut.push(line),
          stderr: (line) => sourceOut.push(`ERR:${line}`),
        },
      );
      expect(sourceCode).toBe(0);
      const raw = sourceOut.join("\n");
      expect(raw).toMatch(/title:/);

      const sourceUpdatedOut: string[] = [];
      const sourceUpdatedCode = await runCollectorCli(
        cliArgs(
          host,
          dataDir,
          "update-item-source",
          created.id,
          "--content",
          raw.replace(/CLI note edited/g, "CLI via source"),
        ),
        {
          stdout: (line) => sourceUpdatedOut.push(line),
          stderr: (line) => sourceUpdatedOut.push(`ERR:${line}`),
        },
      );
      expect(sourceUpdatedCode).toBe(0);
      expect(JSON.parse(sourceUpdatedOut.join("\n")).title).toBe(
        "CLI via source",
      );

      const deleteCode = await runCollectorCli(
        cliArgs(host, dataDir, "delete-item", created.id),
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
          "--base-url",
          "http://127.0.0.1:1",
          "--token",
          "unused",
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
      expect(refuse.join("\n")).toMatch(
        /not running|not_connected|Failed to reach|token file missing/i,
      );
    } finally {
      await host.close();
    }
  });
});
