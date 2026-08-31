import { describe, expect, it } from "vitest";
import {
  createItemLeavingAfterDelete,
  shouldReportFooterLinkError,
} from "./item-leaving-after-delete";

describe("createItemLeavingAfterDelete", () => {
  it("marks and matches only the leaving item id", () => {
    const leaving = createItemLeavingAfterDelete();
    leaving.markItemLeavingAfterDelete("Inbox/gone.md");

    expect(leaving.isItemLeavingAfterDelete("Inbox/gone.md")).toBe(true);
    expect(leaving.isItemLeavingAfterDelete("Inbox/other.md")).toBe(false);
  });

  it("clears so a later load can report errors again", () => {
    const leaving = createItemLeavingAfterDelete();
    leaving.markItemLeavingAfterDelete("Inbox/gone.md");
    leaving.clearItemLeavingAfterDelete();

    expect(leaving.isItemLeavingAfterDelete("Inbox/gone.md")).toBe(false);
  });
});

describe("shouldReportFooterLinkError", () => {
  it("suppresses Item not found style failures while leaving after delete", () => {
    expect(
      shouldReportFooterLinkError({ cancelled: false, leaving: true }),
    ).toBe(false);
  });

  it("suppresses when the effect was cancelled", () => {
    expect(
      shouldReportFooterLinkError({ cancelled: true, leaving: false }),
    ).toBe(false);
  });

  it("still reports for a normal missing id load", () => {
    expect(
      shouldReportFooterLinkError({ cancelled: false, leaving: false }),
    ).toBe(true);
  });
});
