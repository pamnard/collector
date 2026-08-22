import { describe, expect, it, vi } from "vitest";
import {
  createJobPermanentFailureStore,
} from "../../job-permanent-failure.js";
import { enqueueItemDerivedRefreshWithFailureReporting } from "./item-derived-refresh-enqueue.js";

vi.mock("../../jobs/handlers/item-derived-refresh.js", () => ({
  enqueueItemDerivedRefresh: vi.fn(),
}));

import { enqueueItemDerivedRefresh } from "../../jobs/handlers/item-derived-refresh.js";

describe("enqueueItemDerivedRefreshWithFailureReporting (#776)", () => {
  it("surfaces enqueue failure via permanent-failure contract", async () => {
    const store = createJobPermanentFailureStore();
    const seen: Array<{ type: string; error: string; attempts: number }> = [];
    store.subscribe((payload) => {
      seen.push({
        type: payload.type,
        error: payload.error,
        attempts: payload.attempts,
      });
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(enqueueItemDerivedRefresh).mockRejectedValue(
      new Error("queue full"),
    );

    await enqueueItemDerivedRefreshWithFailureReporting(
      {
        requireJobs: () => ({}) as never,
        jobPermanentFailure: store,
      },
      {
        vaultId: "v1",
        vaultPath: "/vault",
        itemId: "n.md",
        contentRevision: 1,
        fileMtimeMs: 100,
      },
    );

    expect(seen).toEqual([
      {
        type: "itemDerivedRefresh",
        error: "enqueue failed: queue full",
        attempts: 0,
      },
    ]);
    errorSpy.mockRestore();
  });
});
