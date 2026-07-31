import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertItem = vi.fn();

vi.mock("@collector/core", async () => {
  const actual = await vi.importActual<typeof import("@collector/core")>(
    "@collector/core",
  );
  return {
    ...actual,
    upsertItem: (...args: unknown[]) => upsertItem(...args),
    resolveOrCreateInboxFolder: vi.fn(async () => "Inbox"),
    createFolder: vi.fn(async () => undefined),
  };
});

import { createItemsCrud } from "./items-crud.js";

describe("createItemsCrud createItem sourceRef (#28)", () => {
  beforeEach(() => {
    upsertItem.mockReset();
    upsertItem.mockResolvedValue({ id: "Inbox/n.md" });
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
  });
});
