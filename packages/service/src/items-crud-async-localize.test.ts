import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertItem = vi.fn();
const readItemRawMarkdown = vi.fn();
const readItemFile = vi.fn();
const writeItemRawMarkdown = vi.fn();

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
    resolveOrCreateInboxFolder: vi.fn(async () => "Inbox"),
    createFolder: vi.fn(async () => undefined),
  };
});

import { createItemsCrud } from "./items-crud.js";

describe("createItemsCrud async localize (#768)", () => {
  beforeEach(() => {
    upsertItem.mockReset();
    readItemRawMarkdown.mockReset();
    readItemFile.mockReset();
    writeItemRawMarkdown.mockReset();
    upsertItem.mockResolvedValue({
      id: "Inbox/n.md",
      url: null,
      content_revision: 1,
      folder_path: "Inbox",
    });
    readItemRawMarkdown.mockResolvedValue("![x](https://cdn.example/x.png)\n");
    readItemFile.mockResolvedValue({
      id: "Inbox/n.md",
      folder_path: "Inbox",
      content_revision: 1,
    });
    writeItemRawMarkdown.mockResolvedValue({
      id: "Inbox/n.md",
      folder_path: "Inbox",
      content_revision: 1,
    });
  });

  it("updateItemSource enqueues derived refresh instead of awaiting localize", async () => {
    const enqueueItemDerivedRefresh = vi.fn(async () => undefined);
    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({
          path: "/vault",
          vault: { id: "vault-1" },
        }),
        getContext: () => ({
          fs: {
            exists: async () => true,
            stat: async () => ({ mtimeMs: 123 }),
            readText: async () => "![x](https://cdn.example/x.png)\n",
          },
          index: {},
        }),
        getIndex: () => ({
          listItemFilesByIds: async () => [
            {
              id: "Inbox/n.md",
              url: null,
              folder_path: "Inbox",
              content_revision: 1,
            },
          ],
        }),
        normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh,
      } as never,
      () => "unused",
    );

    await crud.updateItemSource("Inbox/n.md", "![x](https://cdn.example/x.png)\n");

    expect(enqueueItemDerivedRefresh).toHaveBeenCalledTimes(1);
    expect(enqueueItemDerivedRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultId: "vault-1",
        vaultPath: "/vault",
        itemId: "Inbox/n.md",
        contentRevision: 1,
        fileMtimeMs: 123,
      }),
    );
  });
});
