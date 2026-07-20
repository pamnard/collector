import { describe, expect, it } from "vitest";
import { CliUsageError, parseCliArgs } from "./parse-args.js";

describe("parseCliArgs (#172/#173)", () => {
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

  it("parses create-item / update-item / delete-item", () => {
    expect(
      parseCliArgs([
        "--data-dir",
        "/data",
        "create-item",
        "--title",
        "Hello",
        "--type",
        "note",
        "--content",
        "body",
      ]),
    ).toEqual({
      command: {
        name: "create-item",
        title: "Hello",
        content_type: "note",
        content: "body",
      },
      dataDir: "/data",
    });

    expect(
      parseCliArgs([
        "--data-dir",
        "/data",
        "update-item",
        "id1",
        "--title",
        "Next",
      ]),
    ).toEqual({
      command: { name: "update-item", itemId: "id1", title: "Next" },
      dataDir: "/data",
    });

    expect(
      parseCliArgs(["--data-dir", "/data", "delete-item", "id1"]),
    ).toEqual({
      command: { name: "delete-item", itemId: "id1" },
      dataDir: "/data",
    });
  });

  it("parses tag and folder writes", () => {
    expect(
      parseCliArgs([
        "--data-dir",
        "/data",
        "create-tag",
        "--name",
        "work",
        "--color",
        "#fff",
      ]),
    ).toEqual({
      command: { name: "create-tag", tagName: "work", color: "#fff" },
      dataDir: "/data",
    });
    expect(
      parseCliArgs(["--data-dir", "/data", "create-folder", "Inbox/A"]),
    ).toEqual({
      command: { name: "create-folder", folderPath: "Inbox/A" },
      dataDir: "/data",
    });
    expect(
      parseCliArgs([
        "--data-dir",
        "/data",
        "move-item",
        "id1",
        "--folder",
        "Inbox",
      ]),
    ).toEqual({
      command: { name: "move-item", itemId: "id1", folderPath: "Inbox" },
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
