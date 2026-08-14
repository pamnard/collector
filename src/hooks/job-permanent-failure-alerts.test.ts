import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JobPermanentFailure, Subscription } from "@collector/api";
import { subscribeJobPermanentFailureAlerts } from "./job-permanent-failure-alerts.ts";

function subscriptionFrom(teardown: () => void): Subscription {
  const unsub = () => {
    teardown();
  };
  unsub.unsubscribe = unsub;
  return unsub as Subscription;
}

describe("subscribeJobPermanentFailureAlerts (#640)", () => {
  it("upserts a danger AlertStack entry for a permanent failure", () => {
    let listener: ((failure: JobPermanentFailure) => void) | undefined;
    const jobs = {
      subscribeJobPermanentFailure: (
        onUpdate: (failure: JobPermanentFailure) => void,
      ) => {
        listener = onUpdate;
        return subscriptionFrom(() => {
          listener = undefined;
        });
      },
    };
    const upserted: Array<{ id: string; input: unknown }> = [];

    const unsubscribe = subscribeJobPermanentFailureAlerts(jobs, {
      upsert(id, input) {
        upserted.push({ id, input });
      },
    });
    assert.equal(typeof listener, "function");

    listener?.({
      id: "j1",
      type: "__test_noop",
      error: "noop permanent fail",
      attempts: 1,
    });

    assert.deepEqual(upserted, [
      {
        id: "job-failed-j1",
        input: {
          tone: "danger",
          dismissible: true,
          message: "__test_noop: noop permanent fail",
        },
      },
    ]);

    unsubscribe();
    listener?.({
      id: "j2",
      type: "__test_noop",
      error: "late",
      attempts: 1,
    });
    assert.equal(upserted.length, 1);
  });
});
