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
    loadTagMaps: vi.fn(async () => ({
      byId: new Map(),
      byName: new Map(),
    })),
    serializeItemDocument: vi.fn(
      (item: { title: string }, body: string) =>
        `---\ntitle: ${item.title}\n---\n${body}`,
    ),
    readItemContent: vi.fn(async () => "body"),
    moveItemToFolder: vi.fn(),
    ensureTagsByName: vi.fn(),
  };
});

import { createItemsCrud } from "./items-crud.js";

describe("createItemsCrud extract auto enqueue", () => {
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
      metadata: {},
    });
    readItemRawMarkdown.mockResolvedValue("---\ntitle: n\n---\nbody\n");
    readItemFile.mockResolvedValue({
      id: "Inbox/n.md",
      folder_path: "Inbox",
      content_revision: 1,
      title: "n",
      description: "",
      url: null,
      content_type: "note",
      source_type: "manual",
      metadata: {},
      properties: {},
      tag_ids: [],
      collection_ids: [],
      word_count: 0,
      character_count: 0,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      vault_id: "vault-1",
    });
    writeItemRawMarkdown.mockResolvedValue({
      id: "Inbox/n.md",
      folder_path: "Inbox",
      content_revision: 1,
      metadata: {},
    });
  });

  it("enqueues extract auto when body bytes change", async () => {
    const enqueueItemExtractAuto = vi.fn(async () => undefined);
    readItemRawMarkdown.mockResolvedValueOnce("---\ntitle: n\n---\nold\n");
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
            readText: async () => "---\ntitle: n\n---\nold\n",
          },
          index: {},
        }),
        getIndex: () => ({}),
        normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto,
      } as never,
      () => "unused",
    );

    await crud.updateItemSource(
      "Inbox/n.md",
      "---\ntitle: n\n---\nhttps://www.instagram.com/p/NewCode/\n",
    );

    expect(enqueueItemExtractAuto).toHaveBeenCalledTimes(1);
    expect(enqueueItemExtractAuto).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultId: "vault-1",
        vaultPath: "/vault",
        itemId: "Inbox/n.md",
        contentRevision: 1,
      }),
    );
  });

  it("does not enqueue extract auto on metadata-only update", async () => {
    const enqueueItemExtractAuto = vi.fn(async () => undefined);
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
            readText: async () => "---\ntitle: n\n---\nbody\n",
          },
          index: {},
        }),
        getIndex: () => ({
          listItemFilesByIds: async () => [
            {
              id: "Inbox/n.md",
              folder_path: "Inbox",
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
        normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto,
      } as never,
      () => "unused",
    );

    await crud.updateItem("Inbox/n.md", {
      metadata: {
        extract_auto: {
          X: { attempted_at: "2026-01-01T00:00:00.000Z", ok: true },
        },
      },
    });

    expect(enqueueItemExtractAuto).not.toHaveBeenCalled();
    expect(writeItemRawMarkdown).toHaveBeenCalled();
  });
});
