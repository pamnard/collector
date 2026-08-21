import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertItem = vi.fn();
const readItemRawMarkdown = vi.fn();
const readItemFile = vi.fn();
const writeItemRawMarkdown = vi.fn();
const deleteItem = vi.fn();

vi.mock("@collector/core", async () => {
  const actual = await vi.importActual<typeof import("@collector/core")>(
    "@collector/core",
  );
  return {
    ...actual,
    upsertItem: (...args: unknown[]) => upsertItem(...args),
    readItemRawMarkdown: (...args: unknown[]) => readItemRawMarkdown(...args),
    readItemFile: (...args: unknown[]) => readItemFile(...args),
    writeItemRawMarkdown: (...args: unknown[]) => writeItemRawMarkdown(...args),
    deleteItem: (...args: unknown[]) => deleteItem(...args),
    resolveOrCreateInboxFolder: vi.fn(async () => "Inbox"),
    createFolder: vi.fn(async () => undefined),
  };
});

import { createItemsCrud } from "./items-crud.js";

function testNormalizeMarkdown(raw: string): { text: string; changed: boolean } {
  if (raw.includes("DIRTY")) {
    return { text: raw.replace("DIRTY", "clean"), changed: true };
  }
  return { text: raw, changed: false };
}

describe("createItemsCrud createItem sourceRef (#28)", () => {
  beforeEach(() => {
    upsertItem.mockReset();
    readItemRawMarkdown.mockReset();
    readItemFile.mockReset();
    writeItemRawMarkdown.mockReset();
    deleteItem.mockReset();
    upsertItem.mockResolvedValue({ id: "Inbox/n.md" });
    readItemRawMarkdown.mockResolvedValue("raw-md");
    readItemFile.mockResolvedValue({ id: "Inbox/n.md", folder_path: "Inbox" });
    writeItemRawMarkdown.mockResolvedValue({
      id: "Inbox/n.md",
      folder_path: "Inbox",
    });
    deleteItem.mockResolvedValue(undefined);
  });

  it("forwards sourceRef to upsertItem", async () => {
    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({
          path: "/vault",
          vault: { id: "00000000-0000-4000-8000-000000000001" },
        }),
        getContext: () => ({ fs: {}, index: {} }),
        getIndex: () => ({}),
        normalizeMarkdown: testNormalizeMarkdown,
        localizeRemoteDisplayAssets: async ({ rawMarkdown }) => ({
          text: rawMarkdown,
          changed: false,
        }),
      } as never,
      () => "n",
    );

    const sourceRef = {
      plugin_id: "mock",
      external_id: "ext-1",
    };
    await crud.createItem({
      title: "T",
      content_type: "note",
      sourceRef,
    });

    expect(upsertItem).toHaveBeenCalledWith(
      expect.anything(),
      "/vault",
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({ sourceRef }),
    );
    expect(readItemRawMarkdown).toHaveBeenCalled();
  });

  it("notifies vault presentation after create even when normalize is a no-op", async () => {
    const onVaultPresentationChanged = vi.fn();
    const vaultId = "00000000-0000-4000-8000-000000000001";
    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({
          path: "/vault",
          vault: { id: vaultId },
        }),
        getContext: () => ({ fs: {}, index: {} }),
        getIndex: () => ({}),
        onVaultPresentationChanged,
        normalizeMarkdown: testNormalizeMarkdown,
        localizeRemoteDisplayAssets: async ({ rawMarkdown }) => ({
          text: rawMarkdown,
          changed: false,
        }),
      } as never,
      () => "n",
    );

    await crud.createItem({
      title: "Clean note",
      content_type: "note",
      content: "already clean",
    });

    expect(onVaultPresentationChanged).toHaveBeenCalledTimes(1);
    expect(onVaultPresentationChanged).toHaveBeenCalledWith({
      vaultId,
      kind: "itemCreated",
      itemId: "Inbox/n.md",
      folderPath: "Inbox",
    });
    expect(writeItemRawMarkdown).not.toHaveBeenCalled();
  });

  it("notifies vault presentation exactly once when create normalize rewrites", async () => {
    const onVaultPresentationChanged = vi.fn();
    const vaultId = "00000000-0000-4000-8000-000000000001";
    readItemRawMarkdown.mockResolvedValue("DIRTY body");
    writeItemRawMarkdown.mockResolvedValue({
      id: "Inbox/n.md",
      folder_path: "Inbox",
    });
    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({
          path: "/vault",
          vault: { id: vaultId },
        }),
        getContext: () => ({ fs: {}, index: {} }),
        getIndex: () => ({}),
        onVaultPresentationChanged,
        normalizeMarkdown: testNormalizeMarkdown,
        localizeRemoteDisplayAssets: async ({ rawMarkdown }) => ({
          text: rawMarkdown,
          changed: false,
        }),
      } as never,
      () => "n",
    );

    await crud.createItem({
      title: "Dirty note",
      content_type: "note",
      content: "DIRTY",
    });

    expect(writeItemRawMarkdown).toHaveBeenCalledTimes(1);
    expect(onVaultPresentationChanged).toHaveBeenCalledTimes(1);
    expect(onVaultPresentationChanged).toHaveBeenCalledWith({
      vaultId,
      kind: "itemCreated",
      itemId: "Inbox/n.md",
      folderPath: "Inbox",
    });
  });

  it("rolls back created item when localize fails (#739)", async () => {
    const onVaultPresentationChanged = vi.fn();
    upsertItem.mockResolvedValue({ id: "Inbox/n.md", url: null });
    readItemRawMarkdown.mockResolvedValue(
      "![x](https://cdn.example/x.png)\n",
    );
    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({
          path: "/vault",
          vault: { id: "00000000-0000-4000-8000-000000000001" },
        }),
        getContext: () => ({ fs: {}, index: {} }),
        getIndex: () => ({}),
        onVaultPresentationChanged,
        normalizeMarkdown: testNormalizeMarkdown,
        localizeRemoteDisplayAssets: async () => {
          throw new Error("download failed");
        },
      } as never,
      () => "n",
    );

    await expect(
      crud.createItem({
        title: "Bad remote",
        content_type: "note",
        content: "![x](https://cdn.example/x.png)",
      }),
    ).rejects.toThrow(/download failed/);

    expect(deleteItem).toHaveBeenCalledWith(
      expect.anything(),
      "/vault",
      "Inbox/n.md",
    );
    expect(onVaultPresentationChanged).not.toHaveBeenCalled();
  });
});
