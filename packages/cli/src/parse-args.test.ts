import { describe, expect, it } from "vitest";
import { CliUsageError, parseCliArgs } from "./parse-args.js";

const BASE = ["--base-url", "http://127.0.0.1:9"] as const;

describe("parseCliArgs (#172/#173 / #550 G)", () => {
  it("parses health with --base-url and --data-dir", () => {
    expect(parseCliArgs([...BASE, "--data-dir", "/data", "health"])).toEqual({
      command: { name: "health" },
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
  });

  it("parses search with --base-url and --token", () => {
    expect(
      parseCliArgs([
        ...BASE,
        "--token",
        "secret",
        "search",
        "hello",
        "world",
      ]),
    ).toEqual({
      command: { name: "search", query: "hello world" },
      baseUrl: "http://127.0.0.1:9",
      token: "secret",
    });
  });

  it("parses get-item", () => {
    expect(
      parseCliArgs([...BASE, "--data-dir", "/data", "get-item", "abc"]),
    ).toEqual({
      command: { name: "get-item", itemId: "abc" },
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
  });

  it("parses create-item / update-item / delete-item", () => {
    expect(
      parseCliArgs([
        ...BASE,
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
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });

    expect(
      parseCliArgs([
        ...BASE,
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
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });

    expect(
      parseCliArgs([...BASE, "--data-dir", "/data", "delete-item", "id1"]),
    ).toEqual({
      command: { name: "delete-item", itemId: "id1" },
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
  });

  it("parses get/update item source (#351)", () => {
    expect(
      parseCliArgs([...BASE, "--data-dir", "/data", "get-item-source", "id1"]),
    ).toEqual({
      command: { name: "get-item-source", itemId: "id1" },
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
    expect(
      parseCliArgs([
        ...BASE,
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
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
  });

  it("parses tag and folder writes", () => {
    expect(
      parseCliArgs([
        ...BASE,
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
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
    expect(
      parseCliArgs([...BASE, "--data-dir", "/data", "create-folder", "Inbox/A"]),
    ).toEqual({
      command: { name: "create-folder", folderPath: "Inbox/A" },
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
    expect(parseCliArgs([...BASE, "--data-dir", "/data", "list-folders"])).toEqual({
      command: { name: "list-folders" },
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
    expect(
      parseCliArgs([
        ...BASE,
        "--data-dir",
        "/data",
        "rename-folder",
        "Work/A",
        "Work/B",
      ]),
    ).toEqual({
      command: { name: "rename-folder", oldPath: "Work/A", newPath: "Work/B" },
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
    expect(
      parseCliArgs([
        ...BASE,
        "--data-dir",
        "/data",
        "move-folder",
        "Work/B",
        "Archive/B",
      ]),
    ).toEqual({
      command: { name: "move-folder", oldPath: "Work/B", newPath: "Archive/B" },
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
    expect(
      parseCliArgs([...BASE, "--data-dir", "/data", "delete-folder", "Archive/B"]),
    ).toEqual({
      command: { name: "delete-folder", folderPath: "Archive/B" },
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
    expect(
      parseCliArgs([
        ...BASE,
        "--data-dir",
        "/data",
        "move-item",
        "id1",
        "--folder",
        "Inbox",
      ]),
    ).toEqual({
      command: { name: "move-item", itemId: "id1", folderPath: "Inbox" },
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
  });

  it("parses media CRUD commands (#353)", () => {
    expect(
      parseCliArgs([...BASE, "--data-dir", "/data", "list-item-media", "Inbox/a.md"]),
    ).toEqual({
      command: { name: "list-item-media", itemId: "Inbox/a.md" },
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });

    expect(
      parseCliArgs([
        ...BASE,
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
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });

    expect(
      parseCliArgs([
        ...BASE,
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
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });

    expect(
      parseCliArgs([
        ...BASE,
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
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });

    expect(
      parseCliArgs([
        ...BASE,
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
      baseUrl: "http://127.0.0.1:9",
      dataDir: "/data",
    });
  });

  it("rejects missing endpoint", () => {
    expect(() => parseCliArgs(["health"])).toThrow(CliUsageError);
  });

  it("allows --data-dir without --base-url (resolve reads baseUrl file)", () => {
    expect(parseCliArgs(["--data-dir", "/data", "health"])).toEqual({
      command: { name: "health" },
      dataDir: "/data",
    });
  });

  it("rejects removed --ipc-path", () => {
    expect(() => parseCliArgs(["--ipc-path", "/s", "health"])).toThrow(
      /--ipc-path is removed/,
    );
  });

  it("rejects unknown command", () => {
    expect(() =>
      parseCliArgs([...BASE, "--data-dir", "/data", "no-such-command"]),
    ).toThrow(/Unknown command: no-such-command/);
  });

  it("rejects update-item without field flags", () => {
    expect(() =>
      parseCliArgs([...BASE, "--data-dir", "/data", "update-item", "id1"]),
    ).toThrow(/at least one field flag/);
  });
});
