import { describe, expect, it } from "vitest";
import {
  JOB_TYPE_CATALOG,
  defineJobType,
  testNoopJobType,
} from "./job-types.js";

describe("job type catalog (#629)", () => {
  it("includes __test_noop in JOB_TYPE_CATALOG", () => {
    expect(JOB_TYPE_CATALOG.some((t) => t.id === "__test_noop")).toBe(true);
    expect(testNoopJobType.id).toBe("__test_noop");
  });

  it("parses valid noop payload", () => {
    expect(testNoopJobType.payload.parse({})).toEqual({});
    expect(
      testNoopJobType.payload.parse({
        fail: "retryable",
        retryAfterMs: 10,
      }),
    ).toEqual({ fail: "retryable", retryAfterMs: 10 });
  });

  it("rejects invalid noop payload", () => {
    expect(() =>
      testNoopJobType.payload.parse({ fail: "nope" }),
    ).toThrow();
  });

  it("keeps catalog ids unique", () => {
    const ids = JOB_TYPE_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defineJobType returns id + schema", () => {
    const t = defineJobType({
      id: "example",
      payload: testNoopJobType.payload,
    });
    expect(t.id).toBe("example");
    expect(t.payload.parse({})).toEqual({});
  });
});
