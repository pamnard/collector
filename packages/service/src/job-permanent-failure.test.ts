import { describe, expect, it, vi } from "vitest";
import {
  createJobPermanentFailureStore,
  reportEnqueueFailure,
} from "./job-permanent-failure.js";

describe("createJobPermanentFailureStore (#630)", () => {
  it("notifies subscribers", () => {
    const store = createJobPermanentFailureStore();
    const seen: Array<{ id: string; type: string }> = [];
    const sub = store.subscribe((payload) => {
      seen.push(payload);
    });
    store.notify({
      id: "j1",
      type: "__test_noop",
      error: "boom",
      attempts: 1,
    });
    expect(seen).toEqual([
      { id: "j1", type: "__test_noop", error: "boom", attempts: 1 },
    ]);
    sub.unsubscribe();
    store.notify({
      id: "j2",
      type: "__test_noop",
      error: "again",
      attempts: 2,
    });
    expect(seen).toHaveLength(1);
  });
});

describe("reportEnqueueFailure (#639)", () => {
  it("notifies with synthetic id and attempts 0", () => {
    const store = createJobPermanentFailureStore();
    const seen: Array<{
      id: string;
      type: string;
      error: string;
      attempts: number;
    }> = [];
    store.subscribe((payload) => {
      seen.push(payload);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportEnqueueFailure(store, "vaultIndexSync", new Error("db locked"), () =>
      "fixed-id",
    );

    expect(seen).toEqual([
      {
        id: "enqueue-failed:vaultIndexSync:fixed-id",
        type: "vaultIndexSync",
        error: "enqueue failed: db locked",
        attempts: 0,
      },
    ]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
