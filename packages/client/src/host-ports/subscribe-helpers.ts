/**
 * Shared abort / throttled-republish / error-forward helpers for host-ports (#797).
 */

import type { ServiceSubscribeHandlers } from "@collector/api";
import { asCollectorApiError } from "@collector/api";

export type SubscribeErrorHandlers = Pick<ServiceSubscribeHandlers, "onError">;

export function withAbortBridge(external?: AbortSignal): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      external.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }
  return {
    signal: controller.signal,
    dispose: () => controller.abort(),
  };
}

export function createThrottledPublisher(
  fn: () => void,
  intervalMs: number,
): { schedule: () => void; flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRun = 0;

  const run = () => {
    lastRun = Date.now();
    fn();
  };

  return {
    schedule() {
      const elapsed = Date.now() - lastRun;
      if (elapsed >= intervalMs) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        run();
        return;
      }
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        run();
      }, intervalMs - elapsed);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export function forwardSubscribeError(
  handlers: SubscribeErrorHandlers | undefined,
  label: string,
  error: unknown,
  signal?: AbortSignal,
): void {
  if (signal?.aborted) {
    return;
  }
  handlers?.onError?.(label, asCollectorApiError(error));
}

/** Fire-and-forget publish that skips work/errors once `signal` is aborted. */
export function voidSubscribePublish(
  signal: AbortSignal,
  publish: () => Promise<void>,
  handlers: SubscribeErrorHandlers | undefined,
  label: string,
): void {
  void (async () => {
    try {
      if (signal.aborted) {
        return;
      }
      await publish();
    } catch (error: unknown) {
      forwardSubscribeError(handlers, label, error, signal);
    }
  })();
}

/**
 * Load-then-deliver publish: skips `onResult` (and errors) if aborted after await.
 * Prefer this over calling user callbacks inside a raw `voidSubscribePublish` body.
 */
export function voidSubscribePublishResult<T>(
  signal: AbortSignal,
  load: () => Promise<T>,
  onResult: (value: T) => void,
  handlers: SubscribeErrorHandlers | undefined,
  label: string,
): void {
  voidSubscribePublish(
    signal,
    async () => {
      const value = await load();
      if (signal.aborted) {
        return;
      }
      onResult(value);
    },
    handlers,
    label,
  );
}
