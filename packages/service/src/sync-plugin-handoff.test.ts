import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedSyncItem } from "@collector/api";
import { createSyncPluginHandoff } from "./sync-plugin-handoff.js";

describe("createSyncPluginHandoff", () => {
  const createItem = vi.fn();
  const attachMediaFiles = vi.fn();

  beforeEach(() => {
    createItem.mockReset();
    attachMediaFiles.mockReset();
    createItem.mockImplementation(async (input: { title: string }) => ({
      id: `Inbox/${input.title}.md`,
      title: input.title,
    }));
    attachMediaFiles.mockResolvedValue([]);
  });

  function handoff() {
    return createSyncPluginHandoff({ createItem, attachMediaFiles });
  }

  const baseItem: NormalizedSyncItem = {
    remoteId: "r1",
    title: "Hello",
    content_type: "note",
    body: "body text",
  };

  it("creates item without sourceRef or media (Telegram-shaped)", async () => {
    const result = await handoff().importItem(baseItem);

    expect(createItem).toHaveBeenCalledWith({
      title: "Hello",
      content_type: "note",
      content: "body text",
      url: null,
      source_type: "plugin",
    });
    expect(attachMediaFiles).not.toHaveBeenCalled();
    expect(result).toEqual({ itemId: "Inbox/Hello.md", remoteId: "r1" });
  });

  it("passes sourceRef and folder_path when provided", async () => {
    await handoff().importItem({
      ...baseItem,
      folder_path: "Projects",
      sourceRef: {
        plugin_id: "mock",
        external_id: "ext-1",
      },
    });

    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        folder_path: "Projects",
        sourceRef: {
          plugin_id: "mock",
          external_id: "ext-1",
        },
        source_type: "plugin",
      }),
    );
  });

  it("attaches media after createItem", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await handoff().importItem({
      ...baseItem,
      content_type: "image",
      media: [{ name: "a.png", bytes }],
    });

    expect(attachMediaFiles).toHaveBeenCalledWith("Inbox/Hello.md", [
      { name: "a.png", bytes },
    ]);
  });

  it("rejects empty remoteId", async () => {
    await expect(
      handoff().importItem({ ...baseItem, remoteId: "  " }),
    ).rejects.toThrow(/remoteId/);
  });
});
