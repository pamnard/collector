import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldDeferListPaintUntilCovers } from "./dashboard-cold-cover-reveal.ts";

/**
 * Mirrors commitWorkingToDisplay hold-paint sequencing (#855):
 * when the cold-window gate is on, list paint must not run until covers settle.
 */
async function simulateColdCommitOrder(options: {
  blockOnCovers: boolean;
  coverFlightMs: number;
}): Promise<string[]> {
  const steps: string[] = [];
  const deferListPaint = shouldDeferListPaintUntilCovers(options.blockOnCovers);

  if (!deferListPaint) {
    steps.push("paint-list");
  }

  steps.push("start-cover-flight");
  await new Promise<void>((resolve) => {
    setTimeout(resolve, options.coverFlightMs);
  });
  steps.push("covers-ready");

  if (deferListPaint) {
    steps.push("paint-list");
  }

  return steps;
}

describe("shouldDeferListPaintUntilCovers (#855 cold window)", () => {
  it("holds list paint until after cover flight when blocking on covers", async () => {
    const steps = await simulateColdCommitOrder({
      blockOnCovers: true,
      coverFlightMs: 5,
    });
    assert.deepEqual(steps, [
      "start-cover-flight",
      "covers-ready",
      "paint-list",
    ]);
  });

  it("paints the list before cover flight when not blocking on covers", async () => {
    const steps = await simulateColdCommitOrder({
      blockOnCovers: false,
      coverFlightMs: 5,
    });
    assert.deepEqual(steps, [
      "paint-list",
      "start-cover-flight",
      "covers-ready",
    ]);
  });
});
