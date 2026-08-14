import { describe, expect, it } from "vitest";
import {
  mapHandlerThrownToApiError,
  hostWireError,
} from "./errors.js";

describe("host transport error mapping helpers", () => {
  it("preserves thrown CollectorApiError from handlers", () => {
    const thrown = hostWireError({
      layer: "domain",
      code: "index_unhealthy",
      message: "index bad",
    });
    expect(mapHandlerThrownToApiError(thrown)).toEqual(thrown.collectorError);
  });

  it("maps unknown throws to domain failed", () => {
    expect(mapHandlerThrownToApiError(new Error("boom"))).toEqual({
      layer: "domain",
      code: "failed",
      message: "boom",
    });
  });
});
