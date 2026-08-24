import { describe, expect, it } from "vitest";
import {
  canClaimMore,
  settlePollTick,
  shouldSkipVaultMutatingBulk,
} from "./job-runner-poll-phases.js";

describe("job-runner-poll-phases (#793)", () => {
  describe("canClaimMore", () => {
    it("is false when stopped or at concurrency", () => {
      expect(
        canClaimMore({ isStopped: true, inFlightSize: 0, concurrency: 2 }),
      ).toBe(false);
      expect(
        canClaimMore({ isStopped: false, inFlightSize: 2, concurrency: 2 }),
      ).toBe(false);
      expect(
        canClaimMore({ isStopped: false, inFlightSize: 1, concurrency: 2 }),
      ).toBe(true);
    });
  });

  describe("shouldSkipVaultMutatingBulk", () => {
    it("skips when a bulk mutator is already in flight", () => {
      expect(shouldSkipVaultMutatingBulk(0)).toBe(false);
      expect(shouldSkipVaultMutatingBulk(1)).toBe(true);
    });
  });

  describe("settlePollTick", () => {
    it("returns none when stopped", () => {
      expect(
        settlePollTick({
          isStopped: true,
          claimed: 1,
          inFlightSize: 0,
          concurrency: 2,
          pollIntervalMs: 500,
        }),
      ).toEqual({ kind: "none" });
    });

    it("schedules immediate when claimed and capacity remains", () => {
      expect(
        settlePollTick({
          isStopped: false,
          claimed: 1,
          inFlightSize: 1,
          concurrency: 2,
          pollIntervalMs: 500,
        }),
      ).toEqual({ kind: "immediate" });
    });

    it("heartbeats when idle", () => {
      expect(
        settlePollTick({
          isStopped: false,
          claimed: 0,
          inFlightSize: 0,
          concurrency: 2,
          pollIntervalMs: 500,
        }),
      ).toEqual({ kind: "heartbeat", delayMs: 500 });
    });

    it("returns none when in-flight filled concurrency after claim", () => {
      expect(
        settlePollTick({
          isStopped: false,
          claimed: 2,
          inFlightSize: 2,
          concurrency: 2,
          pollIntervalMs: 500,
        }),
      ).toEqual({ kind: "none" });
    });
  });
});
