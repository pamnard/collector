import { describe, expect, it, vi } from "vitest";
import type { ItemFile } from "@collector/shared";
import { createItemDetailReloadGate } from "./item-detail-reload-gate";
import { saveItemSource } from "./save-item-source";
import type { ItemDetailSaveSink } from "./item-detail-save-types";

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

describe("saveItemSource", () => {
  it("returns false when source text is null without calling update", async () => {
    const sink = makeSink();
    const updateItemSource = vi.fn();

    const ok = await saveItemSource({
      id: "Inbox/n.md",
      sourceText: null,
      gate: createItemDetailReloadGate(),
      sink,
      updateItemSource,
      reloadAfterSave: vi.fn(),
    });

    expect(ok).toBe(false);
    expect(updateItemSource).not.toHaveBeenCalled();
    expect(sink.setIsSaving).not.toHaveBeenCalled();
  });

  it("updates source, reloads, clears buffers, and finishes to view", async () => {
    const sink = makeSink();
    const gate = createItemDetailReloadGate();
    const updated = { id: "Inbox/n.md" } as ItemFile;
    const updateItemSource = vi.fn(async () => updated);
    const reloadAfterSave = vi.fn(async () => {});

    const ok = await saveItemSource({
      id: "Inbox/n.md",
      sourceText: "# hello",
      gate,
      sink,
      updateItemSource,
      reloadAfterSave,
    });

    expect(ok).toBe(true);
    expect(updateItemSource).toHaveBeenCalledWith("Inbox/n.md", "# hello");
    expect(reloadAfterSave).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "Inbox/n.md",
        gate,
      }),
    );
    expect(sink.setSourceText).toHaveBeenCalledWith(null);
    expect(sink.setSourceBaseline).toHaveBeenCalledWith(null);
    expect(sink.setMode).toHaveBeenCalledWith("view");
    expect(sink.navigate).not.toHaveBeenCalled();
    expect(sink.setIsSaving).toHaveBeenLastCalledWith(false);
  });

  it("surfaces source-save errors via setError", async () => {
    const sink = makeSink();
    const updateItemSource = vi.fn(async () => {
      throw new Error("source failed");
    });

    const ok = await saveItemSource({
      id: "Inbox/n.md",
      sourceText: "x",
      gate: createItemDetailReloadGate(),
      sink,
      updateItemSource,
      reloadAfterSave: vi.fn(),
    });

    expect(ok).toBe(false);
    expect(sink.setError).toHaveBeenCalledWith("source failed");
    expect(sink.setSourceText).not.toHaveBeenCalled();
  });
});
