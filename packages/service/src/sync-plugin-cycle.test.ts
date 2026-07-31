import { describe, expect, it, vi } from "vitest";
import type { NormalizedSyncItem, SyncPlugin } from "@collector/api";
import { runSyncPluginCycle } from "./sync-plugin-cycle.js";
import { createMockSyncPlugin } from "./sync-plugin-mock.js";
import { createSyncPluginHandoff } from "./sync-plugin-handoff.js";

function note(remoteId: string, title: string): NormalizedSyncItem {
  return {
    remoteId,
    title,
    content_type: "note",
    body: title,
  };
}

describe("runSyncPluginCycle", () => {
  it("authenticate → pull → import → ack → nextCursor", async () => {
    const plugin = createMockSyncPlugin({
      items: [note("a", "A"), note("b", "B")],
    });
    const importItem = vi.fn(async (item: NormalizedSyncItem) => ({
      remoteId: item.remoteId,
      itemId: `Inbox/${item.title}.md`,
    }));

    let cursor: string | null = null;
    const result = await runSyncPluginCycle({
      plugin,
      cursor,
      importItem,
    });
    cursor = result.nextCursor;

    expect(plugin.authenticateCalls).toBe(1);
    expect(plugin.pullCalls).toBe(1);
    expect(importItem).toHaveBeenCalledTimes(2);
    expect(plugin.ackCalls).toEqual([["a", "b"]]);
    expect(plugin.pending()).toEqual([]);
    expect(result.itemIds).toEqual(["Inbox/A.md", "Inbox/B.md"]);
    expect(cursor).toMatch(/^mock:1:/);

    const second = await runSyncPluginCycle({
      plugin,
      cursor,
      importItem,
    });
    expect(second.importedRemoteIds).toEqual([]);
    expect(second.nextCursor).toMatch(/^mock:2:/);
    expect(plugin.ackCalls).toHaveLength(1);
  });

  it("on mid-batch import failure: ack successes, keep cursor (throw)", async () => {
    const plugin = createMockSyncPlugin({
      items: [note("ok", "Ok"), note("bad", "Bad")],
    });
    const importItem = vi.fn(async (item: NormalizedSyncItem) => {
      if (item.remoteId === "bad") {
        throw new Error("import failed");
      }
      return { remoteId: item.remoteId, itemId: "Inbox/Ok.md" };
    });

    await expect(
      runSyncPluginCycle({ plugin, cursor: "prev", importItem }),
    ).rejects.toThrow(/import failed/);

    expect(plugin.ackCalls).toEqual([["ok"]]);
    expect(plugin.pending().map((i) => i.remoteId)).toEqual(["bad"]);
  });

  it("works without ack", async () => {
    const plugin: SyncPlugin = {
      id: "no-ack",
      async pull() {
        return {
          items: [note("x", "X")],
          nextCursor: "c1",
        };
      },
    };
    const result = await runSyncPluginCycle({
      plugin,
      cursor: null,
      importItem: async (item) => ({
        remoteId: item.remoteId,
        itemId: "Inbox/X.md",
      }),
    });
    expect(result.nextCursor).toBe("c1");
    expect(result.importedRemoteIds).toEqual(["x"]);
  });
});

describe("mock + handoff cycle", () => {
  it("pull → createItem via handoff → ack → cursor", async () => {
    const plugin = createMockSyncPlugin({
      items: [
        note("t1", "One"),
        {
          remoteId: "t2",
          title: "Two",
          content_type: "note",
          sourceRef: { plugin_id: "mock", external_id: "t2" },
        },
      ],
    });
    const createItem = vi.fn(async (input: { title: string }) => ({
      id: `Inbox/${input.title}.md`,
      title: input.title,
    }));
    const attachMediaFiles = vi.fn(async () => []);
    const handoff = createSyncPluginHandoff({ createItem, attachMediaFiles });

    let cursor: string | null = null;
    const result = await runSyncPluginCycle({
      plugin,
      cursor,
      importItem: (item) => handoff.importItem(item),
    });
    cursor = result.nextCursor;

    expect(createItem).toHaveBeenCalledTimes(2);
    expect(createItem.mock.calls[0][0]).not.toHaveProperty("sourceRef");
    expect(createItem.mock.calls[1][0].sourceRef).toEqual({
      plugin_id: "mock",
      external_id: "t2",
    });
    expect(plugin.pending()).toEqual([]);
    expect(cursor).toBeTruthy();
  });
});
