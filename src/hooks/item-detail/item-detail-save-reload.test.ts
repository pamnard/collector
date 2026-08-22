import { describe, expect, it, vi } from "vitest";
import { reloadItemDetailAfterSave } from "./item-detail-save-reload";
import { createItemDetailReloadGate } from "./item-detail-reload-gate";

describe("reloadItemDetailAfterSave (#769)", () => {
  it("runs a follow-up reload when derived-complete was suppressed during save reload", async () => {
    const gate = createItemDetailReloadGate();
    let callCount = 0;
    const reload = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        gate.noteSuppressedDerivedComplete("A/x.md");
      }
    });
    const setItem = vi.fn();
    const setContent = vi.fn();
    const setItemTagNames = vi.fn();
    const setFormValues = vi.fn();

    await reloadItemDetailAfterSave({
      itemId: "A/x.md",
      gate,
      reload,
      setItem,
      setContent,
      setItemTagNames,
      setFormValues,
    });

    expect(reload).toHaveBeenCalledTimes(2);
    expect(gate.shouldSuppressVaultSoftReload("A/x.md")).toBe(false);
    expect(gate.hasPendingDerivedCompleteReload("A/x.md")).toBe(false);
  });

  it("does not follow-up reload when only presentation was suppressed", async () => {
    const gate = createItemDetailReloadGate();
    const reload = vi.fn(async () => {});

    await reloadItemDetailAfterSave({
      itemId: "A/x.md",
      gate,
      reload,
      setItem: vi.fn(),
      setContent: vi.fn(),
      setItemTagNames: vi.fn(),
      setFormValues: vi.fn(),
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
