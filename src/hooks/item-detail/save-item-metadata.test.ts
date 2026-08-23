import { describe, expect, it, vi } from "vitest";
import type { ItemFile } from "@collector/shared";
import type { ItemFormValues } from "../../types/item";
import { createItemDetailReloadGate } from "./item-detail-reload-gate";
import { saveItemMetadata } from "./save-item-metadata";
import type { ItemDetailSaveSink } from "./item-detail-save-types";

function makeFormValues(
  overrides: Partial<ItemFormValues> = {},
): ItemFormValues {
  return {
    title: "Title",
    description: "Desc",
    url: "https://example.com",
    content_type: "note",
    content: "body",
    tags: ["a"],
    folder_path: "Inbox",
    properties: {},
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

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

describe("saveItemMetadata", () => {
  it("rejects empty title with validation error and does not call update", async () => {
    const sink = makeSink();
    const updateItem = vi.fn();
    const reloadAfterSave = vi.fn();

    const ok = await saveItemMetadata({
      id: "Inbox/n.md",
      formValues: makeFormValues({ title: "   " }),
      gate: createItemDetailReloadGate(),
      sink,
      updateItem,
      reloadAfterSave,
    });

    expect(ok).toBe(false);
    expect(sink.setError).toHaveBeenCalledWith("Название обязательно");
    expect(updateItem).not.toHaveBeenCalled();
    expect(reloadAfterSave).not.toHaveBeenCalled();
    expect(sink.setIsSaving).not.toHaveBeenCalled();
  });

  it("updates, reloads, finishes to view, and navigates on id change", async () => {
    const sink = makeSink();
    const gate = createItemDetailReloadGate();
    const updated = { id: "Inbox/renamed.md" } as ItemFile;
    const updateItem = vi.fn(async () => updated);
    const reloadAfterSave = vi.fn(async () => {});

    const ok = await saveItemMetadata({
      id: "Inbox/n.md",
      formValues: makeFormValues({ title: " Renamed " }),
      gate,
      sink,
      updateItem,
      reloadAfterSave,
    });

    expect(ok).toBe(true);
    expect(sink.setIsSaving).toHaveBeenCalledWith(true);
    expect(sink.setError).toHaveBeenCalledWith(null);
    expect(updateItem).toHaveBeenCalledWith("Inbox/n.md", {
      title: "Renamed",
      description: "Desc",
      url: "https://example.com",
      content_type: "note",
      content: "body",
      tags: ["a"],
      folder_path: "Inbox",
      properties: {},
    });
    expect(reloadAfterSave).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "Inbox/renamed.md",
        gate,
        setItem: sink.setItem,
        setContent: sink.setContent,
        setItemTagNames: sink.setItemTagNames,
        setFormValues: sink.setFormValues,
      }),
    );
    expect(sink.setMode).toHaveBeenCalledWith("view");
    expect(sink.navigate).toHaveBeenCalledWith("/item/Inbox/renamed.md", {
      replace: true,
    });
    expect(sink.setIsSaving).toHaveBeenLastCalledWith(false);
  });

  it("surfaces update errors via setError and returns false", async () => {
    const sink = makeSink();
    const updateItem = vi.fn(async () => {
      throw new Error("boom");
    });

    const ok = await saveItemMetadata({
      id: "Inbox/n.md",
      formValues: makeFormValues(),
      gate: createItemDetailReloadGate(),
      sink,
      updateItem,
      reloadAfterSave: vi.fn(),
    });

    expect(ok).toBe(false);
    expect(sink.setError).toHaveBeenCalledWith("boom");
    expect(sink.setMode).not.toHaveBeenCalled();
    expect(sink.setIsSaving).toHaveBeenLastCalledWith(false);
  });
});
