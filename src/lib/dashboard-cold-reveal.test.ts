import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { revealHeldListPaint } from "./dashboard-cold-reveal.ts";

describe("revealHeldListPaint (#855 / #874)", () => {
  it("cancels only this version and skips apply when stale", () => {
    const calls: string[] = [];
    const result = revealHeldListPaint({
      requestVersion: 1,
      getCurrentVersion: () => 2,
      covers: {
        flushPublished: () => {
          calls.push("flushPublished");
        },
        cancelDeferredPublish: (version) => {
          calls.push(`cancel:${version}`);
        },
      },
      flushSync: (fn) => {
        calls.push("flushSync");
        fn();
      },
      applyCommitted: () => {
        calls.push("applyCommitted");
      },
    });
    assert.equal(result, "cancelled-stale");
    assert.deepEqual(calls, ["cancel:1"]);
  });

  it("flushSync runs flushPublished before applyCommitted", () => {
    const calls: string[] = [];
    const result = revealHeldListPaint({
      requestVersion: 3,
      getCurrentVersion: () => 3,
      covers: {
        flushPublished: () => {
          calls.push("flushPublished");
        },
        cancelDeferredPublish: () => {
          calls.push("cancel");
        },
      },
      flushSync: (fn) => {
        calls.push("flushSync-enter");
        fn();
        calls.push("flushSync-exit");
      },
      applyCommitted: () => {
        calls.push("applyCommitted");
      },
    });
    assert.equal(result, "revealed");
    assert.deepEqual(calls, [
      "flushSync-enter",
      "flushPublished",
      "applyCommitted",
      "flushSync-exit",
    ]);
  });

  it("uses flushPublished even after a foreign-version cancel would be a no-op", () => {
    const calls: string[] = [];
    // Simulate: foreign cancel already ran; reveal still must flushPublished.
    const result = revealHeldListPaint({
      requestVersion: 5,
      getCurrentVersion: () => 5,
      covers: {
        flushPublished: () => {
          calls.push("flushPublished");
        },
        cancelDeferredPublish: () => {
          calls.push("cancel");
        },
      },
      flushSync: (fn) => fn(),
      applyCommitted: () => {
        calls.push("apply");
      },
    });
    assert.equal(result, "revealed");
    assert.deepEqual(calls, ["flushPublished", "apply"]);
  });
});
