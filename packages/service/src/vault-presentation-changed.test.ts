import { describe, expect, it, vi } from "vitest";
import { createVaultPresentationChangedStore } from "./vault-presentation-changed.js";

describe("createVaultPresentationChangedStore (#756)", () => {
  it("notifies all subscribers with the full payload", () => {
    const store = createVaultPresentationChangedStore();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = store.subscribe(a);
    store.subscribe(b);

    const upsert = {
      vaultId: "vault-1",
      kind: "itemUpserted" as const,
      itemId: "Inbox/n.md",
      folderPath: "Inbox",
    };
    store.notify(upsert);
    expect(a).toHaveBeenCalledWith(upsert);
    expect(b).toHaveBeenCalledWith(upsert);

    unsubA.unsubscribe();
    const deleted = {
      vaultId: "vault-2",
      kind: "itemDeleted" as const,
      itemId: "Inbox/gone.md",
      folderPath: "Inbox",
    };
    store.notify(deleted);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith(deleted);
  });

  it("forwards move and folderChanged payloads unchanged", () => {
    const store = createVaultPresentationChangedStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.notify({
      vaultId: "v",
      kind: "itemMoved",
      itemId: "B/x.md",
      fromFolderPath: "A",
      toFolderPath: "B",
    });
    store.notify({
      vaultId: "v",
      kind: "folderChanged",
      folderPath: "Projects",
    });

    expect(listener).toHaveBeenNthCalledWith(1, {
      vaultId: "v",
      kind: "itemMoved",
      itemId: "B/x.md",
      fromFolderPath: "A",
      toFolderPath: "B",
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      vaultId: "v",
      kind: "folderChanged",
      folderPath: "Projects",
    });
  });
});
