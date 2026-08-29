import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveCallback } from "./live-callback.ts";

describe("liveCallback", () => {
  it("stable wrapper always invokes the latest target with args", () => {
    const log: Array<{ version: string; args: unknown[] }> = [];
    let target = (...args: unknown[]) => {
      log.push({ version: "v1", args });
      return "v1";
    };
    const wrapped = liveCallback(() => target);

    assert.equal(wrapped("first", 1), "v1");

    target = (...args: unknown[]) => {
      log.push({ version: "v2", args });
      return "v2";
    };

    assert.equal(wrapped("second", 2), "v2");
    assert.deepEqual(log, [
      { version: "v1", args: ["first", 1] },
      { version: "v2", args: ["second", 2] },
    ]);
  });
});
