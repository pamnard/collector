import { describe, expect, it } from "vitest";
import type { LayoutSlotAssignment } from "../../lib/teaser-layout/pick-layout";
import { slotGridStyle } from "./ItemRelatedPanel";

describe("slotGridStyle", () => {
  it("maps placement to CSS grid lines", () => {
    const slot: LayoutSlotAssignment = {
      span: "2x1",
      col: 1,
      row: 0,
      teaserId: "a.md",
      composition: {
        span: "2x1",
        hasImage: false,
        form: "none",
        hasTitle: true,
        titleLen: "short",
        desc: "none",
        extra: "date",
      },
    };
    expect(slotGridStyle(slot)).toEqual({
      gridColumn: "2 / span 2",
      gridRow: "1 / span 1",
    });
  });
});
