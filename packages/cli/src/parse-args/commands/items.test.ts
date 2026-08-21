/**
 * Focused unit tests for CLI parse-args items commands (#718).
 */

import { describe, expect, it } from "vitest";
import { CliUsageError } from "../types.js";
import {
  parseCreateItem,
  parseDeleteItem,
  parseGetItem,
  parseGetItemSource,
  parseImportFolder,
  parseMoveItem,
  parseUpdateItem,
  parseUpdateItemSource,
} from "./items.js";

function expectCliUsage(fn: () => unknown, message: RegExp): void {
  expect(fn).toThrow(CliUsageError);
  expect(fn).toThrow(message);
}

describe("parse-args items commands (#718)", () => {
  describe("get-item / get-item-source / delete-item", () => {
    it("parses a single item id", () => {
      expect(parseGetItem([], ["abc"])).toEqual({
        name: "get-item",
        itemId: "abc",
      });
      expect(parseGetItemSource([], ["abc"])).toEqual({
        name: "get-item-source",
        itemId: "abc",
      });
      expect(parseDeleteItem([], ["abc"])).toEqual({
        name: "delete-item",
        itemId: "abc",
      });
    });

    it("rejects missing or extra positional args", () => {
      expectCliUsage(() => parseGetItem([], []), /get-item/);
      expectCliUsage(() => parseGetItem([], ["a", "b"]), /get-item/);
      expectCliUsage(() => parseGetItemSource([], []), /get-item-source/);
      expectCliUsage(() => parseDeleteItem([], []), /delete-item/);
      expectCliUsage(() => parseDeleteItem([], ["a", "b"]), /delete-item/);
    });
  });

  describe("create-item", () => {
    it("parses required title and optional fields", () => {
      expect(
        parseCreateItem(
          [
            "create-item",
            "--title",
            "Hello",
            "--type",
            "note",
            "--content",
            "body",
            "--description",
            "desc",
            "--url",
            "https://example.com",
            "--folder",
            "Inbox",
          ],
          [],
        ),
      ).toEqual({
        name: "create-item",
        title: "Hello",
        content_type: "note",
        content: "body",
        description: "desc",
        url: "https://example.com",
        folder_path: "Inbox",
      });
    });

    it("defaults content_type to note and allows --content with leading dashes", () => {
      expect(
        parseCreateItem(
          ["create-item", "--title", "T", "--content", "---\ntitle: X\n---\n"],
          [],
        ),
      ).toEqual({
        name: "create-item",
        title: "T",
        content_type: "note",
        content: "---\ntitle: X\n---\n",
      });
    });

    it("rejects positional rest and missing --title", () => {
      expectCliUsage(
        () => parseCreateItem(["create-item", "--title", "T"], ["x"]),
        /create-item/,
      );
      expectCliUsage(
        () => parseCreateItem(["create-item"], []),
        /requires --title/,
      );
    });

    it("rejects invalid --type", () => {
      expectCliUsage(
        () =>
          parseCreateItem(
            ["create-item", "--title", "T", "--type", "nope"],
            [],
          ),
        /Invalid --type/,
      );
    });
  });

  describe("update-item", () => {
    it("parses item id with field flags", () => {
      expect(
        parseUpdateItem(
          [
            "update-item",
            "id1",
            "--title",
            "Next",
            "--type",
            "article",
            "--tags",
            "a,b",
            "--folder",
            "Work",
            "--url",
            "https://ex.test",
          ],
          ["id1"],
        ),
      ).toEqual({
        name: "update-item",
        itemId: "id1",
        title: "Next",
        content_type: "article",
        tags: ["a", "b"],
        folder_path: "Work",
        url: "https://ex.test",
      });
    });

    it("rejects missing --url value and missing field flags", () => {
      expectCliUsage(
        () => parseUpdateItem(["update-item", "id1", "--url"], ["id1"]),
        /Missing value for --url/,
      );
      expectCliUsage(() => parseUpdateItem(["update-item"], []), /update-item/);
      expectCliUsage(
        () =>
          parseUpdateItem(
            ["update-item", "a", "b", "--title", "T"],
            ["a", "b"],
          ),
        /update-item/,
      );
      expectCliUsage(
        () => parseUpdateItem(["update-item", "id1"], ["id1"]),
        /at least one field flag/,
      );
    });
  });

  describe("update-item-source", () => {
    it("parses --content including YAML frontmatter", () => {
      expect(
        parseUpdateItemSource(
          [
            "update-item-source",
            "id1",
            "--content",
            "---\ntitle: X\n---\n\nbody\n",
          ],
          ["id1"],
        ),
      ).toEqual({
        name: "update-item-source",
        itemId: "id1",
        rawMarkdown: "---\ntitle: X\n---\n\nbody\n",
      });
    });

    it("rejects missing id or --content", () => {
      expectCliUsage(
        () => parseUpdateItemSource([], []),
        /update-item-source/,
      );
      expectCliUsage(
        () => parseUpdateItemSource(["update-item-source", "id1"], ["id1"]),
        /requires --content/,
      );
    });
  });

  describe("move-item", () => {
    it("parses item id and --folder", () => {
      expect(
        parseMoveItem(["move-item", "id1", "--folder", "Inbox"], ["id1"]),
      ).toEqual({
        name: "move-item",
        itemId: "id1",
        folderPath: "Inbox",
      });
    });

    it("rejects missing id or --folder", () => {
      expectCliUsage(
        () => parseMoveItem(["move-item", "--folder", "Inbox"], []),
        /move-item/,
      );
      expectCliUsage(
        () => parseMoveItem(["move-item", "id1"], ["id1"]),
        /move-item/,
      );
    });
  });

  describe("import-folder", () => {
    it("parses --path, optional --folder, and --wait", () => {
      expect(
        parseImportFolder(
          [
            "import-folder",
            "--path",
            "/abs/notes",
            "--folder",
            "Inbox",
            "--wait",
          ],
          [],
        ),
      ).toEqual({
        name: "import-folder",
        sourceDirAbs: "/abs/notes",
        folder_path: "Inbox",
        wait: true,
      });
      expect(
        parseImportFolder(["import-folder", "--path", "/abs/notes"], []),
      ).toEqual({
        name: "import-folder",
        sourceDirAbs: "/abs/notes",
        wait: false,
      });
    });

    it("rejects missing --path and positional args", () => {
      expectCliUsage(
        () => parseImportFolder(["import-folder"], []),
        /import-folder requires --path/,
      );
      expectCliUsage(
        () =>
          parseImportFolder(
            ["import-folder", "--path", "/abs"],
            ["extra"],
          ),
        /import-folder/,
      );
    });
  });
});
