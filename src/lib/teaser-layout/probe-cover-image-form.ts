import type { CoverImageForm } from "./cover-image-form";
import { measureCoverImageForm } from "./cover-image-form";

export type ProbeCoverImageForm = (
  src: string,
  signal?: AbortSignal,
) => Promise<CoverImageForm | null>;

/**
 * Load cover pixels in the browser and bucket form.
 * Returns null when the image fails or the load is aborted — never invents a form.
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
    const img = new Image();
    const finish = (form: CoverImageForm | null) => {
      signal?.removeEventListener("abort", onAbort);
      img.onload = null;
      img.onerror = null;
      resolve(form);
    };
    const onAbort = () => {
      img.src = "";
      finish(null);
    };
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
