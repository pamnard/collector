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
        "--type",
        "article",
        "--tags",
        "tag-a,tag-b",
      ]),
    ).toEqual({
      command: {
        name: "update-item",
        itemId: "id1",
        title: "Next",
        content_type: "article",
        tags: ["tag-a", "tag-b"],
      },
      dataDir: "/data",
    });

    expect(
      parseCliArgs(["--data-dir", "/data", "delete-item", "id1"]),
    ).toEqual({
      command: { name: "delete-item", itemId: "id1" },
      dataDir: "/data",
    });
  });

  it("parses get/update item source (#351)", () => {
    expect(
      parseCliArgs(["--data-dir", "/data", "get-item-source", "id1"]),
    ).toEqual({
      command: { name: "get-item-source", itemId: "id1" },
      dataDir: "/data",
    });
    expect(
      parseCliArgs([
        "--data-dir",
        "/data",
        "update-item-source",
        "id1",
        "--content",
        "---\ntitle: X\n---\n\nbody\n",
      ]),
    ).toEqual({
      command: {
        name: "update-item-source",
        itemId: "id1",
        rawMarkdown: "---\ntitle: X\n---\n\nbody\n",
      },
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
    expect(parseCliArgs(["--data-dir", "/data", "list-folders"])).toEqual({
      command: { name: "list-folders" },
      dataDir: "/data",
    });
    expect(
      parseCliArgs([
        "--data-dir",
        "/data",
        "rename-folder",
        "Work/A",
        "Work/B",
      ]),
    ).toEqual({
      command: { name: "rename-folder", oldPath: "Work/A", newPath: "Work/B" },
      dataDir: "/data",
    });
    expect(
      parseCliArgs([
        "--data-dir",
        "/data",
        "move-folder",
        "Work/B",
        "Archive/B",
      ]),
    ).toEqual({
      command: { name: "move-folder", oldPath: "Work/B", newPath: "Archive/B" },
      dataDir: "/data",
    });
    expect(
      parseCliArgs(["--data-dir", "/data", "delete-folder", "Archive/B"]),
    ).toEqual({
      command: { name: "delete-folder", folderPath: "Archive/B" },
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

  it("parses media CRUD commands (#353)", () => {
    expect(
      parseCliArgs(["--data-dir", "/data", "list-item-media", "Inbox/a.md"]),
    ).toEqual({
      command: { name: "list-item-media", itemId: "Inbox/a.md" },
      dataDir: "/data",
    });

    expect(
      parseCliArgs([
        "--data-dir",
        "/data",
        "attach-media",
        "Inbox/a.md",
        "--file",
        "/tmp/shot.png",
        "--filename",
        "cover.png",
      ]),
    ).toEqual({
      command: {
        name: "attach-media",
        itemId: "Inbox/a.md",
        filePath: "/tmp/shot.png",
        filename: "cover.png",
      },
      dataDir: "/data",
    });

    expect(
      parseCliArgs([
        "--data-dir",
        "/data",
        "replace-media",
        "Inbox/a.md",
        "media-1",
        "--file",
        "/tmp/new.jpg",
      ]),
    ).toEqual({
      command: {
        name: "replace-media",
        itemId: "Inbox/a.md",
        mediaId: "media-1",
        filePath: "/tmp/new.jpg",
      },
      dataDir: "/data",
    });

    expect(
      parseCliArgs([
        "--data-dir",
        "/data",
        "delete-media",
        "Inbox/a.md",
        "media-1",
      ]),
    ).toEqual({
      command: {
        name: "delete-media",
        itemId: "Inbox/a.md",
        mediaId: "media-1",
      },
      dataDir: "/data",
    });

    expect(
      parseCliArgs([
        "--data-dir",
        "/data",
        "set-item-cover",
        "Inbox/a.md",
        "media-1",
      ]),
    ).toEqual({
      command: {
        name: "set-item-cover",
        itemId: "Inbox/a.md",
        mediaId: "media-1",
      },
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

  it("rejects unknown command", () => {
    expect(() =>
      parseCliArgs(["--data-dir", "/data", "no-such-command"]),
    ).toThrow(/Unknown command: no-such-command/);
  });

  it("rejects update-item without field flags", () => {
    expect(() =>
      parseCliArgs(["--data-dir", "/data", "update-item", "id1"]),
    ).toThrow(/at least one field flag/);
  });
});
