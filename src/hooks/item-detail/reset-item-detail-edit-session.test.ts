import { describe, expect, it } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { ItemFile } from "@collector/shared";
import type { ItemDetailMode } from "../../components/layout/item-chrome";
import {
  applyItemDetailIdentityChange,
  resetItemDetailEditSession,
} from "./reset-item-detail-edit-session";

type EditSessionOutcome = {
  item: ItemFile | null;
  mode: ItemDetailMode;
  sourceText: string | null;
  sourceBaseline: string | null;
};

function captureEditSession(initial: {
  item: ItemFile | null;
  mode: ItemDetailMode;
  sourceText: string | null;
  sourceBaseline: string | null;
}): {
  outcome: EditSessionOutcome;
  setItem: Dispatch<SetStateAction<ItemFile | null>>;
  setMode: Dispatch<SetStateAction<ItemDetailMode>>;
  setSourceText: Dispatch<SetStateAction<string | null>>;
  setSourceBaseline: Dispatch<SetStateAction<string | null>>;
} {
  const outcome: EditSessionOutcome = { ...initial };

  return {
    outcome,
    setItem: (value) => {
      outcome.item =
        typeof value === "function" ? value(outcome.item) : value;
    },
    setMode: (value) => {
      outcome.mode =
        typeof value === "function" ? value(outcome.mode) : value;
    },
    setSourceText: (value) => {
      outcome.sourceText =
        typeof value === "function" ? value(outcome.sourceText) : value;
    },
    setSourceBaseline: (value) => {
      outcome.sourceBaseline =
        typeof value === "function"
          ? value(outcome.sourceBaseline)
          : value;
    },
  };
}

describe("resetItemDetailEditSession", () => {
  it("after reset: mode is view and both source buffers are null", () => {
    const stub = { id: "kept/item.md" } as ItemFile;
    const { outcome, setMode, setSourceText, setSourceBaseline } =
      captureEditSession({
        item: stub,
        mode: "source",
        sourceText: "draft markdown",
        sourceBaseline: "saved markdown",
      });

    resetItemDetailEditSession({
      setMode,
      setSourceText,
      setSourceBaseline,
    });

    expect(outcome).toEqual({
      item: stub,
      mode: "view",
      sourceText: null,
      sourceBaseline: null,
    });
  });
});

describe("applyItemDetailIdentityChange", () => {
  it("when id changes: item cleared, mode view, source buffers null", () => {
    const stub = { id: "old/note.md" } as ItemFile;
    const { outcome, setItem, setMode, setSourceText, setSourceBaseline } =
      captureEditSession({
        item: stub,
        mode: "form",
        sourceText: "unsaved draft",
        sourceBaseline: "previous baseline",
      });

    const changed = applyItemDetailIdentityChange({
      previousId: "old/note.md",
      nextId: "new/note.md",
      setItem,
      setMode,
      setSourceText,
      setSourceBaseline,
    });

    expect(changed).toBe(true);
    expect(outcome).toEqual({
      item: null,
      mode: "view",
      sourceText: null,
      sourceBaseline: null,
    });
  });

  it("when id is unchanged: edit session state stays put", () => {
    const stub = { id: "same/note.md" } as ItemFile;
    const { outcome, setItem, setMode, setSourceText, setSourceBaseline } =
      captureEditSession({
        item: stub,
        mode: "source",
        sourceText: "kept draft",
        sourceBaseline: "kept baseline",
      });

    const changed = applyItemDetailIdentityChange({
      previousId: "same/note.md",
      nextId: "same/note.md",
      setItem,
      setMode,
      setSourceText,
      setSourceBaseline,
    });

    expect(changed).toBe(false);
    expect(outcome).toEqual({
      item: stub,
      mode: "source",
      sourceText: "kept draft",
      sourceBaseline: "kept baseline",
    });
  });

  it("on first load: item cleared and edit session reset to view", () => {
    const { outcome, setItem, setMode, setSourceText, setSourceBaseline } =
      captureEditSession({
        item: { id: "stale" } as ItemFile,
        mode: "form",
        sourceText: "leftover",
        sourceBaseline: "leftover baseline",
      });

    const changed = applyItemDetailIdentityChange({
      previousId: undefined,
      nextId: "first/note.md",
      setItem,
      setMode,
      setSourceText,
      setSourceBaseline,
    });

    expect(changed).toBe(true);
    expect(outcome).toEqual({
      item: null,
      mode: "view",
      sourceText: null,
      sourceBaseline: null,
    });
  });
});
