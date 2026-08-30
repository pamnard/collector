import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import {
  flattenFolderPaths,
  loadTelegramPluginConfig,
  resolveTelegramDestinationFolder,
  saveTelegramPluginConfig,
  updateTelegramPluginConfig,
} from "./telegram-config.js";
import {
  deriveTelegramTitle,
  mapTelegramMessageToItem,
  messageHasImportableContent,
  selectAlbumsToClose,
} from "./telegram-map.js";
import { baseConfig, tempDataDir } from "./telegram-test-harness.js";

describe("telegram-config (#415 / #433 / #922)", () => {
  it("resolveTelegramDestinationFolder falls back to Inbox", () => {
    expect(
      resolveTelegramDestinationFolder("Missing", ["Inbox", "Work"]),
    ).toBe(INBOX_FOLDER_NAME);
    expect(resolveTelegramDestinationFolder("Work", ["Inbox", "Work"])).toBe(
      "Work",
    );
    expect(resolveTelegramDestinationFolder("", ["Inbox"])).toBe(
      INBOX_FOLDER_NAME,
    );
  });

  it("flattenFolderPaths walks tree", () => {
    expect(
      flattenFolderPaths([
        { path: "Inbox", children: [] },
        {
          path: "A",
          children: [{ path: "A/B", children: [] }],
        },
      ]),
    ).toEqual(["Inbox", "A", "A/B"]);
  });

  it("load/save/update config persists awaiting_delete and snaps folder", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    await saveTelegramPluginConfig(
      fs,
      dataDir,
      "v1",
      baseConfig({
        folder_path: "Gone",
        awaiting_delete: [{ chat_id: 1, message_id: 2 }],
        imported: [{ chat_id: 1, message_id: 2 }],
        sync_interval_ms: 120_000,
      }),
    );
    const updated = await updateTelegramPluginConfig(
      fs,
      dataDir,
      "v1",
      {},
      ["Inbox", "Work"],
    );
    expect(updated.folder_path).toBe(INBOX_FOLDER_NAME);
    expect(updated.awaiting_delete).toEqual([{ chat_id: 1, message_id: 2 }]);
    expect(updated.imported).toEqual([{ chat_id: 1, message_id: 2 }]);
    expect(updated.sync_interval_ms).toBe(120_000);
    const loaded = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(loaded.enabled).toBe(true);
    expect(loaded.bot_username).toBe("bot");
    expect(loaded.pending_albums).toEqual([]);
    expect(loaded.imported).toEqual([{ chat_id: 1, message_id: 2 }]);
    expect(loaded.sync_interval_ms).toBe(120_000);
  });

  it("missing imported / sync_interval_ms normalize to defaults", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const path = join(dataDir, "sync-plugins", "telegram", "v1.json");
    await fs.mkdir(join(dataDir, "sync-plugins", "telegram"));
    await fs.writeText(
      path,
      `${JSON.stringify({
        schema_version: 1,
        enabled: true,
        folder_path: "Inbox",
        bot_username: null,
        last_sync_at: null,
        awaiting_delete: [],
      })}\n`,
    );
    const loaded = await loadTelegramPluginConfig(fs, dataDir, "v1");
    expect(loaded.imported).toEqual([]);
    expect(loaded.sync_interval_ms).toBe(300_000);
  });
});

describe("telegram-map (#415 / #433 / #922)", () => {
  it("deriveTelegramTitle and map omit sourceRef", () => {
    expect(
      deriveTelegramTitle({
        message_id: 1,
        date: 0,
        chat: { id: 1, type: "private" },
        text: "Hello\nworld",
      }),
    ).toBe("Hello");
    expect(
      messageHasImportableContent({
        message_id: 1,
        date: 0,
        chat: { id: 1, type: "private" },
        video: { file_id: "v", file_unique_id: "u" },
      }),
    ).toBe(true);
    expect(
      deriveTelegramTitle({
        message_id: 1,
        date: 0,
        chat: { id: 1, type: "private" },
        video: { file_id: "v", file_unique_id: "u" },
      }),
    ).toBe("Telegram video");
    const item = mapTelegramMessageToItem(
      {
        message_id: 2,
        date: 0,
        chat: { id: 9, type: "private" },
        text: "body",
      },
      "Inbox",
    );
    expect(item.remoteId).toBe("9:2");
    expect(item.sourceRef).toBeUndefined();
    expect(item.folder_path).toBe("Inbox");
  });

  it("mapTelegramMessageToItem preserves text_link as markdown body; title stays plain", () => {
    const item = mapTelegramMessageToItem(
      {
        message_id: 3,
        date: 0,
        chat: { id: 9, type: "private" },
        text: "Try Product today",
        entities: [
          {
            type: "text_link",
            offset: 4,
            length: 7,
            url: "https://example.com/p",
          },
        ],
      },
      "Inbox",
    );
    expect(item.body).toBe("Try [Product](https://example.com/p) today");
    expect(item.title).toBe("Try Product today");
  });

  it("selectAlbumsToClose settles idle pending albums", () => {
    const albums = new Map([
      [
        "100:g1",
        {
          chat_id: 100,
          media_group_id: "g1",
          messages: [
            {
              message_id: 1,
              date: 0,
              chat: { id: 100, type: "private" },
              media_group_id: "g1",
              photo: [
                {
                  file_id: "p",
                  file_unique_id: "u",
                  width: 1,
                  height: 1,
                },
              ],
            },
          ],
        },
      ],
    ]);
    expect(
      selectAlbumsToClose({
        pendingBeforeKeys: new Set(["100:g1"]),
        albums,
        touchedKeys: new Set(),
        batchMessagesInOrder: [],
      }),
    ).toEqual(["100:g1"]);
  });
});
