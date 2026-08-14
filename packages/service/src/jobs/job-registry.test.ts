import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  JOB_TYPE_CATALOG,
  defineJobType,
  testNoopJobType,
} from "@collector/shared";
import { createJobRegistry } from "./job-registry.js";

describe("createJobRegistry (#629)", () => {
  it("registers handler for catalog type and parses payload", async () => {
    const registry = createJobRegistry(JOB_TYPE_CATALOG);
    let seen: unknown;
    registry.register(testNoopJobType, async (job) => {
      seen = job.payload;
      return { status: "ok" };
    });

    expect(registry.has("__test_noop")).toBe(true);
    expect(registry.parsePayload("__test_noop", { fail: "permanent" })).toEqual(
      { fail: "permanent" },
    );

    const entry = registry.requireEntry("__test_noop");
    const result = await entry.handler({
      id: "j1",
      type: "__test_noop",
      payload: { fail: "permanent" },
      attempts: 0,
    });
    expect(result).toEqual({ status: "ok" });
    expect(seen).toEqual({ fail: "permanent" });
  });

  it("throws when registering a type not in the catalog", () => {
    const registry = createJobRegistry(JOB_TYPE_CATALOG);
    const foreign = defineJobType({
      id: "not_in_catalog",
      payload: z.object({}),
    });
    expect(() =>
      registry.register(foreign, async () => ({ status: "ok" })),
    ).toThrow(/not in catalog/i);
  });

  it("throws on double register of the same type", () => {
    const registry = createJobRegistry(JOB_TYPE_CATALOG);
    registry.register(testNoopJobType, async () => ({ status: "ok" }));
    expect(() =>
      registry.register(testNoopJobType, async () => ({ status: "ok" })),
    ).toThrow(/already registered/i);
  });

  it("parsePayload throws for unknown type", () => {
    const registry = createJobRegistry(JOB_TYPE_CATALOG);
    registry.register(testNoopJobType, async () => ({ status: "ok" }));
    expect(() => registry.parsePayload("missing", {})).toThrow(
      /unknown job type/i,
    );
  });

  it("parsePayload throws ZodError for invalid payload", () => {
    const registry = createJobRegistry(JOB_TYPE_CATALOG);
    registry.register(testNoopJobType, async () => ({ status: "ok" }));
    expect(() =>
      registry.parsePayload("__test_noop", { fail: "nope" }),
    ).toThrow();
  });

  it("requireEntry throws when handler is missing", () => {
    const registry = createJobRegistry(JOB_TYPE_CATALOG);
    expect(() => registry.requireEntry("__test_noop")).toThrow(
      /no handler registered/i,
    );
  });

  it("assertReady distinguishes unknown type vs missing handler", () => {
    const registry = createJobRegistry(JOB_TYPE_CATALOG);
    expect(() => registry.assertReady("missing")).toThrow(/unknown job type/i);
    expect(() => registry.assertReady("__test_noop")).toThrow(
      /no handler registered/i,
    );
    registry.register(testNoopJobType, async () => ({ status: "ok" }));
    expect(() => registry.assertReady("__test_noop")).not.toThrow();
  });

  it("assertAllRegistered throws until every catalog type has a handler", () => {
    const registry = createJobRegistry(JOB_TYPE_CATALOG);
    expect(() => registry.assertAllRegistered()).toThrow(
      /no handler registered/i,
    );
    registry.register(testNoopJobType, async () => ({ status: "ok" }));
    expect(() => registry.assertAllRegistered()).not.toThrow();
  });

  it("knowsType reflects catalog membership", () => {
    const registry = createJobRegistry(JOB_TYPE_CATALOG);
    expect(registry.knowsType("__test_noop")).toBe(true);
    expect(registry.knowsType("missing")).toBe(false);
  });

  it("accepts a local test catalog via defineJobType", () => {
    const flaky = defineJobType({
      id: "flaky",
      payload: z.object({}),
    });
    const registry = createJobRegistry([flaky]);
    registry.register(flaky, async () => ({ status: "ok" }));
    expect(registry.has("flaky")).toBe(true);
    expect(registry.parsePayload("flaky", {})).toEqual({});
  });
});
