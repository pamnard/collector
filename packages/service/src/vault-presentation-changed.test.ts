import { describe, expect, it, vi } from "vitest";
import { createVaultPresentationChangedStore } from "./vault-presentation-changed.js";

describe("createVaultPresentationChangedStore", () => {
  it("notifies all subscribers with vaultId", () => {
    const store = createVaultPresentationChangedStore();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = store.subscribe(a);
    store.subscribe(b);

    store.notify("vault-1");
    expect(a).toHaveBeenCalledWith({ vaultId: "vault-1" });
    expect(b).toHaveBeenCalledWith({ vaultId: "vault-1" });

    unsubA.unsubscribe();
    store.notify("vault-2");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith({ vaultId: "vault-2" });
  });
});
