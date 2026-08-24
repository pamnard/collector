import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLinkedAbortController,
  createThrottledPublisher,
} from "./subscribe-helpers.js";

describe("createLinkedAbortController (#798 / #797 seam)", () => {
  it("returns a fresh controller when no external signal is given", () => {
    const linked = createLinkedAbortController();
    expect(linked.signal.aborted).toBe(false);
    linked.abort();
    expect(linked.signal.aborted).toBe(true);
  });

  it("aborts immediately when the external signal is already aborted", () => {
    const external = new AbortController();
    external.abort();
    const linked = createLinkedAbortController(external.signal);
    expect(linked.signal.aborted).toBe(true);
  });

  it("aborts the linked controller when the external signal aborts later", () => {
    const external = new AbortController();
    const linked = createLinkedAbortController(external.signal);
    expect(linked.signal.aborted).toBe(false);
    external.abort();
    expect(linked.signal.aborted).toBe(true);
  });
});

describe("createThrottledPublisher (#798 / #797 seam)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately on first schedule", () => {
    const fn = vi.fn();
    const pub = createThrottledPublisher(fn, 500);
    pub.schedule();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("coalesces schedules inside the interval into one delayed run", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const pub = createThrottledPublisher(fn, 500);
    pub.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
    pub.schedule();
    pub.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(499);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("flush runs immediately and clears a pending timer", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const pub = createThrottledPublisher(fn, 500);
    pub.schedule();
    pub.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
    pub.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel drops a pending scheduled run", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const pub = createThrottledPublisher(fn, 500);
    pub.schedule();
    pub.schedule();
    pub.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
