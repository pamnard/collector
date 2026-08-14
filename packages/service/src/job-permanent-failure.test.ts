import { describe, expect, it } from "vitest";
import { createJobPermanentFailureStore } from "./job-permanent-failure.js";

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
