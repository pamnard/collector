import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COVER_IMAGE_PROBE_TIMEOUT_MS,
  probeCoverImageFormInBrowser,
} from "./probe-cover-image-form";

type FakeImage = {
  onload: ((this: FakeImage, ev: Event) => void) | null;
  onerror: ((this: FakeImage, ev: Event) => void) | null;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
};

describe("probeCoverImageFormInBrowser", () => {
  let lastImage: FakeImage | null;

  beforeEach(() => {
    lastImage = null;
    vi.useFakeTimers();
    vi.stubGlobal(
      "Image",
      class {
        onload: FakeImage["onload"] = null;
        onerror: FakeImage["onerror"] = null;
        naturalWidth = 0;
        naturalHeight = 0;
        #src = "";
        constructor() {
          lastImage = this as FakeImage;
        }
        get src() {
          return this.#src;
        }
        set src(value: string) {
          this.#src = value;
        }
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves null when the image never loads within the timeout", async () => {
    const pending = probeCoverImageFormInBrowser("https://img.example/hang.jpg");
    expect(lastImage).not.toBeNull();
    await vi.advanceTimersByTimeAsync(COVER_IMAGE_PROBE_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
  });

  it("measures form when the image loads before timeout", async () => {
    const pending = probeCoverImageFormInBrowser("https://img.example/ok.jpg");
    expect(lastImage).not.toBeNull();
    lastImage!.naturalWidth = 1920;
    lastImage!.naturalHeight = 1080;
    lastImage!.onload?.(new Event("load"));
    await expect(pending).resolves.toBe("landscape");
  });

  it("resolves null on abort before timeout", async () => {
    const controller = new AbortController();
    const pending = probeCoverImageFormInBrowser(
      "https://img.example/hang.jpg",
      controller.signal,
    );
    controller.abort();
    await expect(pending).resolves.toBeNull();
  });

  it("resolves null on image error", async () => {
    const pending = probeCoverImageFormInBrowser("https://img.example/bad.jpg");
    lastImage!.onerror?.(new Event("error"));
    await expect(pending).resolves.toBeNull();
  });
});
