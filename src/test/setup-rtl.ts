import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import {
  setHostMediaCredentials,
} from "../utils/asset-src";

/**
 * Cover slots require host `/media/derive` credentials (#879 / #882).
 * jsdom UI tests share a fixed stand stub.
 */
setHostMediaCredentials("http://127.0.0.1:9", "test-token");
afterEach(() => {
  setHostMediaCredentials("http://127.0.0.1:9", "test-token");
});

/**
 * IntersectionObserver is missing in jsdom; near-viewport cards need it.
 * Treat observed nodes as intersecting so cover decode can start in tests.
 */
class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.callback(
      [
        {
          isIntersecting: true,
          target,
          intersectionRatio: 1,
          time: 0,
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRect: target.getBoundingClientRect(),
          rootBounds: null,
        },
      ],
      this,
    );
  }

  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.IntersectionObserver = ImmediateIntersectionObserver;
