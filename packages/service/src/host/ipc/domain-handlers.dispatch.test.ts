import { describe, expect, it, vi } from "vitest";
import { createDomainIpcDispatcher } from "./domain-handlers.js";

describe("createDomainIpcDispatcher", () => {
  it("returns undefined for unknown methods", async () => {
    const dispatch = createDomainIpcDispatcher({});
    expect(await dispatch("noSuchMethod", { a: 1 })).toBeUndefined();
  });

  it("forwards params to the registered handler", async () => {
    const handler = vi.fn(async (params?: unknown) => ({ ok: true, params }));
    const dispatch = createDomainIpcDispatcher({
      ping: handler,
    });
    await expect(dispatch("ping", { n: 2 })).resolves.toEqual({
      ok: true,
      params: { n: 2 },
    });
    expect(handler).toHaveBeenCalledWith({ n: 2 });
  });
});
