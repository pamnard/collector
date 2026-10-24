import { describe, expect, it } from "vitest";
import { resolveDropTargetFolder } from "./resolve-drop-target-folder";

describe("resolveDropTargetFolder", () => {
  it("uses the active folder filter path", () => {
    expect(
      resolveDropTargetFolder({ type: "folder", folderPath: "Inbox" }),
    ).toBe("Inbox");
    expect(
      resolveDropTargetFolder({ type: "folder", folderPath: "Projects/Trip" }),
    ).toBe("Projects/Trip");
  });

  it("defaults to Inbox when filter is all or tag", () => {
    expect(resolveDropTargetFolder("all")).toBe("Inbox");
    expect(
      resolveDropTargetFolder({
        type: "tag",
        tagId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe("Inbox");
  });

  it("defaults to Inbox when folder path is blank", () => {
    expect(
      resolveDropTargetFolder({ type: "folder", folderPath: "  " }),
    ).toBe("Inbox");
  });
});
