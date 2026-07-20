import { describe, expect, it } from "vitest";
import { CliUsageError, parseCliArgs } from "./parse-args.js";

describe("parseCliArgs (#172)", () => {
  it("parses health with --data-dir", () => {
    expect(parseCliArgs(["--data-dir", "/data", "health"])).toEqual({
      command: { name: "health" },
      dataDir: "/data",
    });
  });

  it("parses search with --ipc-path", () => {
    expect(
      parseCliArgs(["--ipc-path", "/tmp/x.sock", "search", "hello", "world"]),
    ).toEqual({
      command: { name: "search", query: "hello world" },
      ipcPath: "/tmp/x.sock",
    });
  });

  it("parses get-item", () => {
    expect(
      parseCliArgs(["--data-dir", "/data", "get-item", "abc"]),
    ).toEqual({
      command: { name: "get-item", itemId: "abc" },
      dataDir: "/data",
    });
  });

  it("rejects missing endpoint", () => {
    expect(() => parseCliArgs(["health"])).toThrow(CliUsageError);
  });

  it("rejects both endpoint flags", () => {
    expect(() =>
      parseCliArgs(["--data-dir", "/d", "--ipc-path", "/s", "health"]),
    ).toThrow(/only one/);
  });
});
