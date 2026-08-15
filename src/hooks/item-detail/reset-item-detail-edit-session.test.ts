import { describe, expect, it, vi } from "vitest";
import {
  applyItemDetailIdentityChange,
  resetItemDetailEditSession,
} from "./reset-item-detail-edit-session";

describe("resetItemDetailEditSession", () => {
  it("forces view and clears source edit buffers", () => {
    const setMode = vi.fn();
    const setSourceText = vi.fn();
    const setSourceBaseline = vi.fn();

    resetItemDetailEditSession({
      setMode,
      setSourceText,
      setSourceBaseline,
    });

    expect(setMode).toHaveBeenCalledWith("view");
    expect(setSourceText).toHaveBeenCalledWith(null);
    expect(setSourceBaseline).toHaveBeenCalledWith(null);
  });
});

describe("applyItemDetailIdentityChange", () => {
  it("resets item and edit session when id changes", () => {
    const setItem = vi.fn();
    const setMode = vi.fn();
    const setSourceText = vi.fn();
    const setSourceBaseline = vi.fn();

    const changed = applyItemDetailIdentityChange({
      previousId: "old/note.md",
      nextId: "new/note.md",
      setItem,
      setMode,
      setSourceText,
      setSourceBaseline,
    });

    expect(changed).toBe(true);
    expect(setItem).toHaveBeenCalledWith(null);
    expect(setMode).toHaveBeenCalledWith("view");
    expect(setSourceText).toHaveBeenCalledWith(null);
    expect(setSourceBaseline).toHaveBeenCalledWith(null);
  });

  it("does not reset edit session when id is unchanged", () => {
    const setItem = vi.fn();
    const setMode = vi.fn();
    const setSourceText = vi.fn();
    const setSourceBaseline = vi.fn();

    const changed = applyItemDetailIdentityChange({
      previousId: "same/note.md",
      nextId: "same/note.md",
      setItem,
      setMode,
      setSourceText,
      setSourceBaseline,
    });

    expect(changed).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(setMode).not.toHaveBeenCalled();
    expect(setSourceText).not.toHaveBeenCalled();
    expect(setSourceBaseline).not.toHaveBeenCalled();
  });

  it("treats first load as identity change", () => {
    const setItem = vi.fn();
    const setMode = vi.fn();
    const setSourceText = vi.fn();
    const setSourceBaseline = vi.fn();

    const changed = applyItemDetailIdentityChange({
      previousId: undefined,
      nextId: "first/note.md",
      setItem,
      setMode,
      setSourceText,
      setSourceBaseline,
    });

    expect(changed).toBe(true);
    expect(setItem).toHaveBeenCalledWith(null);
    expect(setMode).toHaveBeenCalledWith("view");
  });
});
