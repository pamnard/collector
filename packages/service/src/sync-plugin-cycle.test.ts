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

function stubHandoff(overrides?: {
  createFromNormalized?: ReturnType<typeof vi.fn>;
  attachMedia?: ReturnType<typeof vi.fn>;
  deleteItem?: ReturnType<typeof vi.fn>;
}) {
  const createFromNormalized =
    overrides?.createFromNormalized ??
    vi.fn(async (item: NormalizedSyncItem) => ({
      remoteId: item.remoteId,
      itemId: `Inbox/${item.title}.md`,
    }));
  const attachMedia = overrides?.attachMedia ?? vi.fn(async () => {});
  const deleteItem = overrides?.deleteItem ?? vi.fn(async () => {});
  return { createFromNormalized, attachMedia, deleteItem };
}

describe("runSyncPluginCycle", () => {
  it("authenticate → pull → create → ack → nextCursor", async () => {
    const plugin = createMockSyncPlugin({
      items: [note("a", "A"), note("b", "B")],
    });
    const handoff = stubHandoff();

    let cursor: string | null = null;
    const result = await runSyncPluginCycle({
      plugin,
      cursor,
      handoff,
    });
    cursor = result.nextCursor;

    expect(plugin.authenticateCalls).toBe(1);
    expect(plugin.pullCalls).toBe(1);
    expect(handoff.createFromNormalized).toHaveBeenCalledTimes(2);
    expect(handoff.attachMedia).toHaveBeenCalledTimes(2);
    expect(plugin.ackCalls).toEqual([["a"], ["b"]]);
    expect(plugin.pending()).toEqual([]);
    expect(result.itemIds).toEqual(["Inbox/A.md", "Inbox/B.md"]);
    expect(cursor).toMatch(/^mock:1:/);

    const second = await runSyncPluginCycle({
      plugin,
      cursor,
      handoff,
    });
    expect(second.importedRemoteIds).toEqual([]);
    expect(second.nextCursor).toMatch(/^mock:2:/);
    expect(plugin.ackCalls).toHaveLength(2);
  });

  it("calls markImported after create and before attach; batches ack", async () => {
    const order: string[] = [];
    const markCalls: string[][] = [];
    const ackCalls: string[][] = [];
    const plugin: SyncPlugin = {
      id: "marked",
      async pull() {
        return {
          items: [note("a", "A"), note("b", "B")],
          nextCursor: "c1",
        };
      },
      async markImported(remoteIds) {
        order.push(`mark:${remoteIds.join(",")}`);
        markCalls.push([...remoteIds]);
      },
      async ack(remoteIds) {
        order.push(`ack:${remoteIds.join(",")}`);
        ackCalls.push([...remoteIds]);
      },
    };
    const handoff = stubHandoff({
      createFromNormalized: vi.fn(async (item: NormalizedSyncItem) => {
        order.push(`create:${item.remoteId}`);
        return { remoteId: item.remoteId, itemId: `Inbox/${item.title}.md` };
      }),
      attachMedia: vi.fn(async (itemId: string) => {
        order.push(`attach:${itemId}`);
      }),
    });
    await runSyncPluginCycle({
      plugin,
      cursor: null,
      handoff,
    });
    expect(markCalls).toEqual([["a"], ["b"]]);
    expect(ackCalls).toEqual([["a", "b"]]);
    expect(order).toEqual([
      "create:a",
      "mark:a",
      "attach:Inbox/A.md",
      "create:b",
      "mark:b",
      "attach:Inbox/B.md",
      "ack:a,b",
    ]);
  });

  it("on attach failure: deleteItem + clearImported; no sticky mark", async () => {
    const markCalls: string[][] = [];
    const clearCalls: string[][] = [];
    const ackCalls: string[][] = [];
    const plugin: SyncPlugin = {
      id: "marked-attach-fail",
      async pull() {
        return {
          items: [note("bad", "Bad")],
          nextCursor: "c1",
        };
      },
      async markImported(remoteIds) {
        markCalls.push([...remoteIds]);
      },
      async clearImported(remoteIds) {
        clearCalls.push([...remoteIds]);
      },
      async ack(remoteIds) {
        ackCalls.push([...remoteIds]);
      },
    };
    const handoff = stubHandoff({
      attachMedia: vi.fn(async () => {
        throw new Error("FOREIGN KEY constraint failed");
      }),
    });
    await expect(
      runSyncPluginCycle({ plugin, cursor: null, handoff }),
    ).rejects.toThrow(/FOREIGN KEY/);
    expect(markCalls).toEqual([["bad"]]);
    expect(handoff.deleteItem).toHaveBeenCalledWith("Inbox/Bad.md");
    expect(clearCalls).toEqual([["bad"]]);
    expect(ackCalls).toEqual([]);
  });

  it("on mid-batch attach failure with markImported: ack already imported ids", async () => {
    const ackCalls: string[][] = [];
    const clearCalls: string[][] = [];
    const plugin: SyncPlugin = {
      id: "marked-fail",
      async pull() {
        return {
          items: [note("ok", "Ok"), note("bad", "Bad")],
          nextCursor: "c1",
        };
      },
      async markImported() {},
      async clearImported(remoteIds) {
        clearCalls.push([...remoteIds]);
      },
      async ack(remoteIds) {
        ackCalls.push([...remoteIds]);
      },
    };
    const handoff = stubHandoff({
      attachMedia: vi.fn(async (itemId: string) => {
        if (itemId.includes("Bad")) {
          throw new Error("attach failed");
        }
      }),
    });
    await expect(
      runSyncPluginCycle({ plugin, cursor: null, handoff }),
    ).rejects.toThrow(/attach failed/);
    expect(handoff.deleteItem).toHaveBeenCalledWith("Inbox/Bad.md");
    expect(clearCalls).toEqual([["bad"]]);
    expect(ackCalls).toEqual([["ok"]]);
  });

  it("on mid-batch create failure: ack successes, keep cursor (throw)", async () => {
    const plugin = createMockSyncPlugin({
      items: [note("ok", "Ok"), note("bad", "Bad")],
    });
    const handoff = stubHandoff({
      createFromNormalized: vi.fn(async (item: NormalizedSyncItem) => {
        if (item.remoteId === "bad") {
          throw new Error("import failed");
        }
        return { remoteId: item.remoteId, itemId: "Inbox/Ok.md" };
      }),
    });

    await expect(
      runSyncPluginCycle({ plugin, cursor: "prev", handoff }),
    ).rejects.toThrow(/import failed/);

    expect(plugin.ackCalls).toEqual([["ok"]]);
    expect(plugin.pending().map((i) => i.remoteId)).toEqual(["bad"]);
    expect(handoff.deleteItem).not.toHaveBeenCalled();
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
      handoff: stubHandoff(),
    });
    expect(result.nextCursor).toBe("c1");
    expect(result.importedRemoteIds).toEqual(["x"]);
  });

  it("retry after attach fail + clear can create once (no durable dup)", async () => {
    const marked = new Set<string>();
    const living = new Map<string, string>();
    let attachFails = true;
    const plugin: SyncPlugin = {
      id: "retry-dedup",
      async pull() {
        const items = marked.has("r1") ? [] : [note("r1", "One")];
        return { items, nextCursor: "c1" };
      },
      async markImported(remoteIds) {
        for (const id of remoteIds) {
          marked.add(id);
        }
      },
      async clearImported(remoteIds) {
        for (const id of remoteIds) {
          marked.delete(id);
        }
      },
      async ack() {},
    };
    const handoff = {
      createFromNormalized: vi.fn(async (item: NormalizedSyncItem) => {
        const itemId = `Inbox/${item.title}-${living.size}.md`;
        living.set(item.remoteId, itemId);
        return { remoteId: item.remoteId, itemId };
      }),
      attachMedia: vi.fn(async () => {
        if (attachFails) {
          throw new Error("FOREIGN KEY constraint failed");
        }
      }),
      deleteItem: vi.fn(async (itemId: string) => {
        for (const [remoteId, id] of living) {
          if (id === itemId) {
            living.delete(remoteId);
          }
        }
      }),
    };

    await expect(
      runSyncPluginCycle({ plugin, cursor: null, handoff }),
    ).rejects.toThrow(/FOREIGN KEY/);
    expect(living.size).toBe(0);
    expect(marked.size).toBe(0);

    attachFails = false;
    const ok = await runSyncPluginCycle({ plugin, cursor: null, handoff });
    expect(ok.itemIds).toHaveLength(1);
    expect(living.size).toBe(1);
    expect(handoff.createFromNormalized).toHaveBeenCalledTimes(2);
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
    const deleteItem = vi.fn(async () => {});
    const handoff = createSyncPluginHandoff({
      createItem,
      attachMediaFiles,
      deleteItem,
    });

    let cursor: string | null = null;
    const result = await runSyncPluginCycle({
      plugin,
      cursor,
      handoff,
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
