import { describe, expect, it, vi } from "vitest";
import type { JobHandlerResult } from "./job-types.js";
import type { JobRow } from "./job-store-types.js";
import {
  decideExecuteSettlement,
  isOkHandlerResult,
  isPermanentFailResult,
  isRetryableFailResult,
  parseExecutePayload,
  retryAfterMsFromResult,
  runHandlerWithTimeout,
} from "./job-runner-execute-phases.js";

function jobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    type: "noop",
    payload_json: "{}",
    status: "running",
    priority: 0,
    idempotency_key: null,
    attempts: 0,
    max_attempts: 3,
    available_at: "2020-01-01T00:00:00.000Z",
    started_at: "2020-01-01T00:00:00.000Z",
    finished_at: null,
    last_error: null,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("job-runner-execute-phases (#793)", () => {
  describe("parseExecutePayload", () => {
    it("fails when no handler is registered", () => {
      const parsed = parseExecutePayload(jobRow(), {
        has: () => false,
        parsePayload: () => ({}),
      });
      expect(parsed).toEqual({
        ok: false,
        error: "no handler registered for job type: noop",
      });
    });

    it("fails on invalid JSON", () => {
      const parsed = parseExecutePayload(jobRow({ payload_json: "{" }), {
        has: () => true,
        parsePayload: () => ({}),
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error).toMatch(/invalid payload_json/);
      }
    });

    it("fails when registry parse throws", () => {
      const parsed = parseExecutePayload(jobRow(), {
        has: () => true,
        parsePayload: () => {
          throw new Error("bad shape");
        },
      });
      expect(parsed).toEqual({
        ok: false,
        error: "invalid job payload: bad shape",
      });
    });

    it("returns parsed payload", () => {
      const parsed = parseExecutePayload(jobRow({ payload_json: '{"a":1}' }), {
        has: () => true,
        parsePayload: (_type, raw) => raw,
      });
      expect(parsed).toEqual({ ok: true, payload: { a: 1 } });
    });
  });

  describe("status predicates + settle", () => {
    it("classifies ok / permanent / retryable results", () => {
      const ok: JobHandlerResult = { status: "ok" };
      const permanent: JobHandlerResult = {
        status: "fail",
        retryable: false,
        error: "nope",
      };
      const retryable: JobHandlerResult = {
        status: "fail",
        retryable: true,
        error: "later",
        retryAfterMs: 1000,
      };
      expect(isOkHandlerResult(ok)).toBe(true);
      expect(isPermanentFailResult(permanent)).toBe(true);
      expect(isRetryableFailResult(retryable)).toBe(true);
      expect(retryAfterMsFromResult(retryable)).toBe(1000);
      expect(retryAfterMsFromResult(permanent)).toBeUndefined();
    });

    it("decideExecuteSettlement maps handler outcomes", () => {
      expect(decideExecuteSettlement({ status: "ok" })).toEqual({
        action: "succeeded",
      });
      expect(
        decideExecuteSettlement({
          status: "fail",
          retryable: false,
          error: "x",
        }),
      ).toEqual({ action: "permanent_fail", error: "x" });
      expect(
        decideExecuteSettlement({
          status: "fail",
          retryable: true,
          error: "y",
          retryAfterMs: 50,
        }),
      ).toEqual({
        action: "retry",
        error: "y",
        burnAttempt: false,
        availableAtOffsetMs: 50,
      });
      expect(
        decideExecuteSettlement({
          status: "fail",
          retryable: true,
          error: "z",
        }),
      ).toEqual({
        action: "retry",
        error: "z",
        burnAttempt: true,
        availableAtOffsetMs: null,
      });
    });

    it("maps unexpected handler result to permanent_fail (no throw)", () => {
      const garbage = { status: "wat", detail: 1 } as unknown as JobHandlerResult;
      expect(decideExecuteSettlement(garbage)).toEqual({
        action: "permanent_fail",
        error: 'unexpected job handler result: {"status":"wat","detail":1}',
      });
    });
  });

  describe("runHandlerWithTimeout", () => {
    it("returns handler result before timeout", async () => {
      const result = await runHandlerWithTimeout({
        timeoutMs: 1000,
        handler: async () => ({ status: "ok" }),
      });
      expect(result).toEqual({ status: "ok" });
    });

    it("rejects when handler exceeds timeout", async () => {
      await expect(
        runHandlerWithTimeout({
          timeoutMs: 20,
          handler: async () => {
            await new Promise((r) => setTimeout(r, 200));
            return { status: "ok" };
          },
        }),
      ).rejects.toThrow(/timed out after 20ms/);
    });

    it("clears timer when handler finishes", async () => {
      const clearSpy = vi.spyOn(globalThis, "clearTimeout");
      await runHandlerWithTimeout({
        timeoutMs: 1000,
        handler: async () => ({ status: "ok" }),
      });
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});
