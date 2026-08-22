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

describe("createItemsCrud single derived enqueue (#776)", () => {
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
    readItemRawMarkdown.mockResolvedValue(
      "![x](https://cdn.example/x.png)\n",
    );
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

  it("create with remote assets enqueues at most one derived refresh", async () => {
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
          },
          index: {},
          itemDerivedRefreshJobs: {
            enqueue: enqueueItemDerivedRefresh,
          },
        }),
        getIndex: () => ({}),
        normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh,
      } as never,
      () => "n",
    );

    await crud.createItem({
      title: "Remote",
      content_type: "note",
      content: "![x](https://cdn.example/x.png)\n",
    });

    expect(upsertItem).toHaveBeenCalledWith(
      expect.anything(),
      "/vault",
      "vault-1",
      expect.objectContaining({ deferIndexRefresh: true }),
    );
    expect(enqueueItemDerivedRefresh).toHaveBeenCalledTimes(1);
  });
});
