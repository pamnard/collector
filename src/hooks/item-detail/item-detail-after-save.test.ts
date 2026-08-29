import { describe, expect, it } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { ItemDetailMode } from "../../components/layout/item-chrome";
import {
  clearItemDetailSourceBuffers,
  finishItemDetailSave,
} from "./item-detail-after-save";

type AfterSaveOutcome = {
  mode: ItemDetailMode | null;
  navigation: { to: string; replace: boolean } | null;
};

function captureAfterSave(): {
  outcome: AfterSaveOutcome;
  setMode: Dispatch<SetStateAction<ItemDetailMode>>;
  navigate: NavigateFunction;
} {
  const outcome: AfterSaveOutcome = {
    mode: null,
    navigation: null,
  };

  return {
    outcome,
    setMode: (value) => {
      outcome.mode = typeof value === "function" ? value("form") : value;
    },
    navigate: ((to, options) => {
      outcome.navigation = {
        to: String(to),
        replace: options?.replace === true,
      };
    }) as NavigateFunction,
  };
}

type SourceBufferOutcome = {
  sourceText: string | null | undefined;
  sourceBaseline: string | null | undefined;
};

function captureSourceBuffers(initial: {
  sourceText: string | null;
  sourceBaseline: string | null;
}): {
  outcome: SourceBufferOutcome;
  setSourceText: Dispatch<SetStateAction<string | null>>;
  setSourceBaseline: Dispatch<SetStateAction<string | null>>;
} {
  const outcome: SourceBufferOutcome = {
    sourceText: initial.sourceText,
    sourceBaseline: initial.sourceBaseline,
  };

  return {
    outcome,
    setSourceText: (value) => {
      outcome.sourceText =
        typeof value === "function" ? value(outcome.sourceText ?? null) : value;
    },
    setSourceBaseline: (value) => {
      outcome.sourceBaseline =
        typeof value === "function"
          ? value(outcome.sourceBaseline ?? null)
          : value;
    },
  };
}

describe("finishItemDetailSave", () => {
  it("after save with a new id: mode is view and route replaces to the saved item", () => {
    const { outcome, setMode, navigate } = captureAfterSave();

    finishItemDetailSave({
      previousId: "old/note.md",
      savedId: "new/note.md",
      setMode,
      navigate,
    });

    expect(outcome).toEqual({
      mode: "view",
      navigation: { to: "/item/new/note.md", replace: true },
    });
  });

  it("after save with the same id: mode is view and navigation stays put", () => {
    const { outcome, setMode, navigate } = captureAfterSave();

    finishItemDetailSave({
      previousId: "same/note.md",
      savedId: "same/note.md",
      setMode,
      navigate,
    });

    expect(outcome).toEqual({
      mode: "view",
      navigation: null,
    });
  });
});

describe("clearItemDetailSourceBuffers", () => {
  it("after clear: both source buffers are null", () => {
    const { outcome, setSourceText, setSourceBaseline } = captureSourceBuffers({
      sourceText: "draft markdown",
      sourceBaseline: "saved markdown",
    });

    clearItemDetailSourceBuffers({ setSourceText, setSourceBaseline });

    expect(outcome).toEqual({
      sourceText: null,
      sourceBaseline: null,
    });
  });
});
