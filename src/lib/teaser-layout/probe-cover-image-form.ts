import type { CoverImageForm } from "./cover-image-form";
import {
  COVER_IMAGE_PROBE_TIMEOUT_MS,
  measureCoverImageForm,
} from "./cover-image-form";

export { COVER_IMAGE_PROBE_TIMEOUT_MS } from "./cover-image-form";

export type ProbeCoverImageForm = (
  src: string,
  signal?: AbortSignal,
) => Promise<CoverImageForm | null>;

/**
 * Load cover pixels in the browser and bucket form.
 * Returns null when the image fails, times out, or the load is aborted —
 * never invents a form.
 */
export function probeCoverImageFormInBrowser(
  src: string,
  signal?: AbortSignal,
): Promise<CoverImageForm | null> {
  if (src.trim().length === 0) {
    throw new Error("cover src must be non-empty");
  }
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    let settled = false;
    const img = new Image();
    const finish = (form: CoverImageForm | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      img.onload = null;
      img.onerror = null;
      resolve(form);
    };
    const onAbort = () => {
      img.src = "";
      finish(null);
    };
    const timeoutId = setTimeout(() => {
      img.src = "";
      finish(null);
    }, COVER_IMAGE_PROBE_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    img.onload = () => {
      if (signal?.aborted) {
        finish(null);
        return;
      }
      finish(measureCoverImageForm(img.naturalWidth, img.naturalHeight));
    };
    img.onerror = () => {
      finish(null);
    };
    img.src = src;
  });
}
