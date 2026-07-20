import { useEffect } from "react";
import { markSmokeUiReady } from "../../startup-smoke-capture";

const SHELL_SELECTOR = "[data-smoke-shell]";

/**
 * Release-smoke beacon: after layout paint, require a non-zero shell box and
 * write smoke-ui-ready.flag. Mount only under the real App shell — never under
 * StartupErrorScreen.
 */
export function SmokeUiReadyBeacon() {
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) {
        return;
      }
      const el = document.querySelector(SHELL_SELECTOR);
      if (!(el instanceof HTMLElement)) {
        requestAnimationFrame(run);
        return;
      }
      const rect = el.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) {
        requestAnimationFrame(run);
        return;
      }
      void markSmokeUiReady({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        selector: SHELL_SELECTOR,
      });
    };
    // Two frames: commit + layout/paint.
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
