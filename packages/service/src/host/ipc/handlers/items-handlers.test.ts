import { describe, expect, it, vi } from "vitest";
import { isServiceIpcError } from "../errors.js";
import { DOMAIN_IPC_METHODS as M } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";
import { buildItemsReadHandlers } from "./items-read.js";
import { buildItemsWriteHandlers } from "./items-write.js";

function stubRuntime(overrides: {
  itemsSearch?: Partial<ServiceDomainRuntime["itemsSearch"]>;
  dropImport?: Partial<ServiceDomainRuntime["dropImport"]>;
}): {
  runtime: ServiceDomainRuntime;
  ensureInitialized: ReturnType<typeof vi.fn>;
} {
  const ensureInitialized = vi.fn(async () => undefined);
  const runtime = {
    ensureInitialized,
    itemsSearch: {
      searchItems: vi.fn(async () => []),
      getItemById: vi.fn(async () => null),
      createItem: vi.fn(async (input: unknown) => input),
      updateItem: vi.fn(async (_id: string, input: unknown) => input),
      ...overrides.itemsSearch,
    },
    dropImport: {
      importDroppedFiles: vi.fn(async (input: unknown) => input),
      ...overrides.dropImport,
    },
  } as unknown as ServiceDomainRuntime;
  return { runtime, ensureInitialized };
}

async function expectBadRequest(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    expect.unreachable("expected bad_request");
  } catch (error) {
    expect(isServiceIpcError(error)).toBe(true);
    if (isServiceIpcError(error)) {
      expect(error.code).toBe("bad_request");
    }
  }
}

describe("items IPC handlers validation + forward", () => {
  it("rejects bad searchItems params before ensureInitialized", async () => {
    const { runtime, ensureInitialized } = stubRuntime({});
    const handlers = buildItemsReadHandlers(runtime);
    await expectBadRequest(() => handlers[M.searchItems]!({}));
    expect(ensureInitialized).not.toHaveBeenCalled();
  });

  it("searchItems and getItemById forward after ensureInitialized", async () => {
    const searchItems = vi.fn(async () => [{ id: "a.md" }]);
    const getItemById = vi.fn(async () => ({ id: "a.md" }));
    const { runtime, ensureInitialized } = stubRuntime({
      itemsSearch: { searchItems, getItemById },
    });
    const handlers = buildItemsReadHandlers(runtime);

    await expect(
      handlers[M.searchItems]!({ query: "hello", filter: "all" }),
    ).resolves.toEqual([{ id: "a.md" }]);
    expect(searchItems).toHaveBeenCalledWith("hello", "all");

    await expect(
      handlers[M.getItemById]!({ itemId: "a.md" }),
    ).resolves.toEqual({ id: "a.md" });
    expect(getItemById).toHaveBeenCalledWith("a.md");
    expect(ensureInitialized).toHaveBeenCalledTimes(2);
  });

  it("rejects bad createItem / updateItem before ensureInitialized", async () => {
    const { runtime, ensureInitialized } = stubRuntime({});
    const handlers = buildItemsWriteHandlers(runtime);

    await expectBadRequest(() => handlers[M.createItem]!({ title: "x" }));
    await expectBadRequest(() => handlers[M.updateItem]!({ itemId: "a.md" }));
    expect(ensureInitialized).not.toHaveBeenCalled();
  });

  it("createItem and updateItem forward after ensureInitialized", async () => {
    const createItem = vi.fn(async (input: unknown) => ({ id: "n.md", input }));
    const updateItem = vi.fn(async (id: string, input: unknown) => ({
      id,
      input,
    }));
    const { runtime, ensureInitialized } = stubRuntime({
      itemsSearch: { createItem, updateItem },
    });
    const handlers = buildItemsWriteHandlers(runtime);

    await expect(
      handlers[M.createItem]!({
        title: "Note",
        content_type: "note",
        content: "hi",
      }),
    ).resolves.toMatchObject({ id: "n.md" });
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Note",
        content_type: "note",
        content: "hi",
      }),
    );

    await expect(
      handlers[M.updateItem]!({
        itemId: "n.md",
        input: { title: "Renamed" },
      }),
    ).resolves.toEqual({ id: "n.md", input: { title: "Renamed" } });
    expect(updateItem).toHaveBeenCalledWith("n.md", { title: "Renamed" });
    expect(ensureInitialized).toHaveBeenCalledTimes(2);
  });

  it("importDroppedFiles decodes base64 bytes and forwards", async () => {
    const importDroppedFiles = vi.fn(async (input: unknown) => input);
    const { runtime, ensureInitialized } = stubRuntime({
      dropImport: { importDroppedFiles },
    });
    const handlers = buildItemsWriteHandlers(runtime);
    const dataBase64 = Buffer.from("hello").toString("base64");

    await expect(
      handlers[M.importDroppedFiles]!({
        folder_path: "Inbox",
        files: [
          {
            relativePath: "shot.png",
            name: "shot.png",
            dataBase64,
          },
        ],
      }),
    ).resolves.toMatchObject({ folder_path: "Inbox" });

    expect(importDroppedFiles).toHaveBeenCalledWith({
      folder_path: "Inbox",
      files: [
        {
          relativePath: "shot.png",
          name: "shot.png",
          bytes: Uint8Array.from(Buffer.from("hello")),
        },
      ],
    });
    expect(ensureInitialized).toHaveBeenCalledTimes(1);
  });
});
