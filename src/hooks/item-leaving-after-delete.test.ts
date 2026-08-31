import { describe, expect, it } from "vitest";
import { isItemNotFoundMessage } from "../services/runtime-error";
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

describe("isItemNotFoundMessage", () => {
  it("matches host Item not found prefix", () => {
    expect(
      isItemNotFoundMessage(
        "Item not found: Мемы/f34a02dc-a82f-4f01-88ea-fa73dc5f5c8a.md",
      ),
    ).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isItemNotFoundMessage("network timeout")).toBe(false);
  });
});

describe("shouldReportFooterLinkError", () => {
  it("suppresses while leaving after delete", () => {
    expect(
      shouldReportFooterLinkError({
        cancelled: false,
        leaving: true,
        message: "network timeout",
      }),
    ).toBe(false);
  });

  it("suppresses when the effect was cancelled", () => {
    expect(
      shouldReportFooterLinkError({
        cancelled: true,
        leaving: false,
        message: "network timeout",
      }),
    ).toBe(false);
  });

  it("suppresses when the open item itself is missing", () => {
    expect(
      shouldReportFooterLinkError({
        cancelled: false,
        leaving: false,
        message: "Item not found: Inbox/gone.md",
      }),
    ).toBe(false);
  });

  it("still reports other load failures", () => {
    expect(
      shouldReportFooterLinkError({
        cancelled: false,
        leaving: false,
        message: "network timeout",
      }),
    ).toBe(true);
  });
});
