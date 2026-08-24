/**
 * Shared abort / throttled-republish primitives for host ports (#798 / #797).
 * Ports stay thin; helpers own the nested subscribe scaffolding.
 */

/** Local controller aborted when an optional external signal aborts. */
export function createLinkedAbortController(
  signal?: AbortSignal,
): AbortController {
  const controller = new AbortController();
  if (!signal) {
    return controller;
  }
  if (signal.aborted) {
    controller.abort();
    return controller;
  }
  signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
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
