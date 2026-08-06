import { describe, expect, it } from "vitest";
import { isHostWireError } from "../errors.js";
import {
  asObject,
  badRequest,
  parseDashboardItemSort,
  parseNavFilter,
  requireString,
} from "./params.js";

describe("IPC handler params helpers", () => {
  it("asObject accepts undefined/null/object and rejects arrays/primitives", () => {
    expect(asObject(undefined, "m")).toEqual({});
    expect(asObject(null, "m")).toEqual({});
    expect(asObject({ a: 1 }, "m")).toEqual({ a: 1 });
    expect(() => asObject([], "m")).toThrow();
    expect(() => asObject("x", "m")).toThrow();
  });

  it("requireString requires non-empty string", () => {
    expect(requireString("id", "itemId", "m")).toBe("id");
    expect(() => requireString("", "itemId", "m")).toThrow();
    expect(() => requireString(1, "itemId", "m")).toThrow();
  });

  it("parseNavFilter accepts all / tag / folder", () => {
    expect(parseNavFilter("all", "m")).toBe("all");
    expect(parseNavFilter({ type: "tag", tagId: "t1" }, "m")).toEqual({
      type: "tag",
      tagId: "t1",
    });
    expect(
      parseNavFilter({ type: "folder", folderPath: "Inbox" }, "m"),
    ).toEqual({ type: "folder", folderPath: "Inbox" });
    expect(() => parseNavFilter({ type: "tag" }, "m")).toThrow();
    expect(() => parseNavFilter("inbox", "m")).toThrow();
  });

  it("parseDashboardItemSort validates key/dir", () => {
    expect(parseDashboardItemSort(undefined, "m")).toBeUndefined();
    expect(parseDashboardItemSort({ key: "title", dir: "asc" }, "m")).toEqual({
      key: "title",
      dir: "asc",
    });
    expect(() =>
      parseDashboardItemSort({ key: "tags", dir: "asc" }, "m"),
    ).toThrow();
    expect(() =>
      parseDashboardItemSort({ key: "title", dir: "DESC" }, "m"),
    ).toThrow();
    expect(() => parseDashboardItemSort("title", "m")).toThrow();
  });

  it("badRequest throws HostWireError validation/bad_request", () => {
    try {
      badRequest("nope");
      expect.unreachable("expected throw");
    } catch (error) {
      expect(isHostWireError(error)).toBe(true);
      if (isHostWireError(error)) {
        expect(error.layer).toBe("validation");
        expect(error.code).toBe("bad_request");
        expect(error.message).toBe("nope");
      }
    }
  });
});
