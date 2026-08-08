import { describe, expect, it } from "vitest";
import { liveCallback } from "./live-callback";

describe("liveCallback", () => {
  it("invokes the latest target after the target is replaced", () => {
    let current = () => "before";
    const wrapped = liveCallback(() => current);

    expect(wrapped()).toBe("before");

    current = () => "after";
    expect(wrapped()).toBe("after");
  });
});
