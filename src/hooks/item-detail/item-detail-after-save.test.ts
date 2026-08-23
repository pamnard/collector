import { describe, expect, it, vi } from "vitest";
import {
  clearItemDetailSourceBuffers,
  finishItemDetailSave,
} from "./item-detail-after-save";

describe("finishItemDetailSave", () => {
  it("switches to view and navigates when saved id differs", () => {
    const setMode = vi.fn();
    const navigate = vi.fn();

    finishItemDetailSave({
      previousId: "old/note.md",
      savedId: "new/note.md",
      setMode,
      navigate,
    });

    expect(setMode).toHaveBeenCalledWith("view");
    expect(navigate).toHaveBeenCalledWith("/item/new/note.md", {
      replace: true,
    });
  });

  it("switches to view without navigate when id is unchanged", () => {
    const setMode = vi.fn();
    const navigate = vi.fn();

    finishItemDetailSave({
      previousId: "same/note.md",
      savedId: "same/note.md",
      setMode,
      navigate,
    });

    expect(setMode).toHaveBeenCalledWith("view");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("clearItemDetailSourceBuffers", () => {
  it("clears source text and baseline", () => {
    const setSourceText = vi.fn();
    const setSourceBaseline = vi.fn();

    clearItemDetailSourceBuffers({ setSourceText, setSourceBaseline });

    expect(setSourceText).toHaveBeenCalledWith(null);
    expect(setSourceBaseline).toHaveBeenCalledWith(null);
  });
});
