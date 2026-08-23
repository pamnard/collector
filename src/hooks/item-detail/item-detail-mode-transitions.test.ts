import { describe, expect, it, vi } from "vitest";
import type { ItemFile } from "@collector/shared";
import type { ItemFormValues } from "../../types/item";
import {
  isItemDetailSourceDirty,
  switchItemDetailToForm,
  switchItemDetailToSource,
  switchItemDetailToView,
} from "./item-detail-mode-transitions";
import type {
  ItemDetailSaveSink,
  ItemDetailSaveSnapshot,
} from "./item-detail-save-types";

function makeSink(
  overrides: Partial<ItemDetailSaveSink> = {},
): ItemDetailSaveSink {
  return {
    setFormValues: vi.fn(),
    setItem: vi.fn(),
    setContent: vi.fn(),
    setItemTagNames: vi.fn(),
    setSourceText: vi.fn(),
    setSourceBaseline: vi.fn(),
    setMode: vi.fn(),
    setIsSaving: vi.fn(),
    setError: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ItemDetailSaveSnapshot> = {},
): ItemDetailSaveSnapshot {
  return {
    id: "Inbox/n.md",
    item: { id: "Inbox/n.md", title: "T" } as ItemFile,
    content: "body",
    formValues: {
      title: "T",
      description: "",
      url: "",
      content_type: "note",
      content: "body",
      tags: [],
      folder_path: "Inbox",
      properties: {},
      created_at: "",
      updated_at: "",
    } satisfies ItemFormValues,
    itemTagNames: [],
    sourceText: null,
    sourceBaseline: null,
    mode: "view",
    isSaving: false,
    ...overrides,
  };
}

describe("isItemDetailSourceDirty", () => {
  it("is dirty only when both buffers are set and differ", () => {
    expect(isItemDetailSourceDirty(null, null)).toBe(false);
    expect(isItemDetailSourceDirty("a", null)).toBe(false);
    expect(isItemDetailSourceDirty("a", "a")).toBe(false);
    expect(isItemDetailSourceDirty("a", "b")).toBe(true);
  });
});

describe("switchItemDetailToView", () => {
  it("no-ops when already in view or saving", () => {
    const sink = makeSink();
    const saveMetadata = vi.fn();
    const saveSource = vi.fn();

    switchItemDetailToView({
      snapshot: makeSnapshot({ mode: "view" }),
      sink,
      saveMetadata,
      saveSource,
      isFormDirty: () => true,
    });
    switchItemDetailToView({
      snapshot: makeSnapshot({ mode: "form", isSaving: true }),
      sink,
      saveMetadata,
      saveSource,
      isFormDirty: () => true,
    });

    expect(saveMetadata).not.toHaveBeenCalled();
    expect(saveSource).not.toHaveBeenCalled();
    expect(sink.setMode).not.toHaveBeenCalled();
  });

  it("clears clean source and returns to view", () => {
    const sink = makeSink();
    const saveSource = vi.fn();

    switchItemDetailToView({
      snapshot: makeSnapshot({
        mode: "source",
        sourceText: "same",
        sourceBaseline: "same",
      }),
      sink,
      saveMetadata: vi.fn(),
      saveSource,
      isFormDirty: () => false,
    });

    expect(saveSource).not.toHaveBeenCalled();
    expect(sink.setSourceText).toHaveBeenCalledWith(null);
    expect(sink.setSourceBaseline).toHaveBeenCalledWith(null);
    expect(sink.setMode).toHaveBeenCalledWith("view");
    expect(sink.setError).toHaveBeenCalledWith(null);
  });

  it("saves dirty source when leaving source mode", () => {
    const sink = makeSink();
    const saveSource = vi.fn(async () => true);

    switchItemDetailToView({
      snapshot: makeSnapshot({
        mode: "source",
        sourceText: "new",
        sourceBaseline: "old",
      }),
      sink,
      saveMetadata: vi.fn(),
      saveSource,
      isFormDirty: () => false,
    });

    expect(saveSource).toHaveBeenCalledTimes(1);
  });

  it("returns to view without save when form is clean", () => {
    const sink = makeSink();
    const saveMetadata = vi.fn();

    switchItemDetailToView({
      snapshot: makeSnapshot({ mode: "form" }),
      sink,
      saveMetadata,
      saveSource: vi.fn(),
      isFormDirty: () => false,
    });

    expect(saveMetadata).not.toHaveBeenCalled();
    expect(sink.setMode).toHaveBeenCalledWith("view");
    expect(sink.setError).toHaveBeenCalledWith(null);
  });

  it("saves dirty form when leaving form mode", () => {
    const sink = makeSink();
    const saveMetadata = vi.fn(async () => true);

    switchItemDetailToView({
      snapshot: makeSnapshot({ mode: "form" }),
      sink,
      saveMetadata,
      saveSource: vi.fn(),
      isFormDirty: () => true,
    });

    expect(saveMetadata).toHaveBeenCalledTimes(1);
  });
});

describe("switchItemDetailToForm", () => {
  it("no-ops while saving", async () => {
    const sink = makeSink();
    const saveSource = vi.fn();

    switchItemDetailToForm({
      snapshot: makeSnapshot({ isSaving: true, mode: "source" }),
      sink,
      saveSource,
    });

    await Promise.resolve();
    expect(saveSource).not.toHaveBeenCalled();
    expect(sink.setMode).not.toHaveBeenCalled();
  });

  it("saves dirty source before entering form", async () => {
    const sink = makeSink();
    const saveSource = vi.fn(async () => true);

    switchItemDetailToForm({
      snapshot: makeSnapshot({
        mode: "source",
        sourceText: "new",
        sourceBaseline: "old",
      }),
      sink,
      saveSource,
    });

    await vi.waitFor(() => {
      expect(saveSource).toHaveBeenCalledTimes(1);
      expect(sink.setMode).toHaveBeenCalledWith("form");
    });
  });

  it("aborts entering form when source save fails", async () => {
    const sink = makeSink();
    const saveSource = vi.fn(async () => false);

    switchItemDetailToForm({
      snapshot: makeSnapshot({
        mode: "source",
        sourceText: "new",
        sourceBaseline: "old",
      }),
      sink,
      saveSource,
    });

    await vi.waitFor(() => {
      expect(saveSource).toHaveBeenCalledTimes(1);
    });
    expect(sink.setMode).not.toHaveBeenCalled();
  });
});

describe("switchItemDetailToSource", () => {
  it("no-ops without id or while saving", async () => {
    const sink = makeSink();
    const getItemSource = vi.fn();

    switchItemDetailToSource({
      snapshot: makeSnapshot({ id: undefined }),
      sink,
      saveMetadata: vi.fn(),
      getItemSource,
      isFormDirty: () => false,
    });
    switchItemDetailToSource({
      snapshot: makeSnapshot({ isSaving: true }),
      sink,
      saveMetadata: vi.fn(),
      getItemSource,
      isFormDirty: () => false,
    });

    await Promise.resolve();
    expect(getItemSource).not.toHaveBeenCalled();
  });

  it("saves dirty form then loads source buffers", async () => {
    const sink = makeSink();
    const saveMetadata = vi.fn(async () => true);
    const getItemSource = vi.fn(async () => "raw md");

    switchItemDetailToSource({
      snapshot: makeSnapshot({ mode: "form" }),
      sink,
      saveMetadata,
      getItemSource,
      isFormDirty: () => true,
    });

    await vi.waitFor(() => {
      expect(saveMetadata).toHaveBeenCalledTimes(1);
      expect(getItemSource).toHaveBeenCalledWith("Inbox/n.md");
      expect(sink.setSourceText).toHaveBeenCalledWith("raw md");
      expect(sink.setSourceBaseline).toHaveBeenCalledWith("raw md");
      expect(sink.setMode).toHaveBeenCalledWith("source");
    });
  });

  it("surfaces getItemSource errors via setError", async () => {
    const sink = makeSink();
    const getItemSource = vi.fn(async () => {
      throw new Error("load source failed");
    });

    switchItemDetailToSource({
      snapshot: makeSnapshot({ mode: "view" }),
      sink,
      saveMetadata: vi.fn(),
      getItemSource,
      isFormDirty: () => false,
    });

    await vi.waitFor(() => {
      expect(sink.setError).toHaveBeenCalledWith("load source failed");
    });
    expect(sink.setMode).not.toHaveBeenCalledWith("source");
    expect(sink.setIsSaving).toHaveBeenLastCalledWith(false);
  });
});
