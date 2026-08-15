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
  parseMoveItem,
  parseUpdateItem,
  parseUpdateItemSource,
} from "./items.js";

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
      expect(() => parseGetItem([], [])).toThrow(CliUsageError);
      expect(() => parseGetItem([], ["a", "b"])).toThrow(/get-item/);
      expect(() => parseGetItemSource([], [])).toThrow(/get-item-source/);
      expect(() => parseDeleteItem([], ["a", "b"])).toThrow(/delete-item/);
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
      expect(() => parseCreateItem(["create-item", "--title", "T"], ["x"])).toThrow(
        /create-item/,
      );
      expect(() => parseCreateItem(["create-item"], [])).toThrow(
        /requires --title/,
      );
    });

    it("rejects invalid --type", () => {
      expect(() =>
        parseCreateItem(["create-item", "--title", "T", "--type", "nope"], []),
      ).toThrow(/Invalid --type/);
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
      expect(() =>
        parseUpdateItem(["update-item", "id1", "--url"], ["id1"]),
      ).toThrow(/Missing value for --url/);
      expect(() => parseUpdateItem(["update-item"], [])).toThrow(/update-item/);
      expect(() =>
        parseUpdateItem(["update-item", "a", "b", "--title", "T"], ["a", "b"]),
      ).toThrow(/update-item/);
      expect(() => parseUpdateItem(["update-item", "id1"], ["id1"])).toThrow(
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
      expect(() => parseUpdateItemSource([], [])).toThrow(/update-item-source/);
      expect(() =>
        parseUpdateItemSource(["update-item-source", "id1"], ["id1"]),
      ).toThrow(/requires --content/);
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
      expect(() => parseMoveItem(["move-item", "--folder", "Inbox"], [])).toThrow(
        /move-item/,
      );
      expect(() => parseMoveItem(["move-item", "id1"], ["id1"])).toThrow(
        /move-item/,
      );
    });
  });
});
