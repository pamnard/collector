import { describe, expect, it, vi } from "vitest";
import { createSyncPluginPullHandler } from "./sync-plugin-pull.js";

describe("createSyncPluginPullHandler (#634)", () => {
  it("runs the requested plugin cycle", async () => {
    const syncNow = vi.fn(async () => ({
      importedCount: 1,
      itemIds: ["Inbox/A.md"],
    }));
    const handler = createSyncPluginPullHandler({ syncNow });

    const result = await handler({
      id: "job-1",
      type: "syncPluginPull",
      payload: { pluginId: "telegram" },
      attempts: 1,
    });

    expect(syncNow).toHaveBeenCalledOnce();
    expect(syncNow).toHaveBeenCalledWith("telegram");
    expect(result).toEqual({ status: "ok" });
  });

  it("lets pull failures reach the job runner", async () => {
    const error = new Error("pull exploded");
    const handler = createSyncPluginPullHandler({
      syncNow: vi.fn(async () => {
        throw error;
      }),
    });

    await expect(
      handler({
        id: "job-1",
        type: "syncPluginPull",
        payload: { pluginId: "telegram" },
        attempts: 1,
      }),
    ).rejects.toBe(error);
  });
});
