/**
 * #913 layout contract the dashboard masonry user actually sees:
 * cards must reserve cover WxH before/while the image decodes.
 * After the image settles, card height (and thus scroll length) must not grow.
 *
 * Oracle = DOM geometry proxies (aspect-ratio slot + fingerprint height),
 * not cover-controller internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ItemFile } from "@collector/shared";
import { ItemGridCard } from "./ItemGridCard";

vi.mock("../../hooks/useMainScrollElement", () => ({
  useMainScrollElement: () => document.body,
}));

vi.mock("../../hooks/useNearViewport", () => ({
  NEAR_VIEWPORT_ROOT_MARGIN: "0px",
  useNearViewport: () => true,
  useNearViewportRef: () => ({
    ref: () => {},
    nearViewport: true,
  }),
}));

const GRID_COL_W = 280;
const TEXT_ONLY_H = 231;

function stubItem(id: string): ItemFile {
  return {
    id,
    title: id,
    description: "body",
    url: null,
    content_type: "note",
    tag_ids: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    thumbnail: "cover.webp",
  } as ItemFile;
}

function fingerprintHeight(card: HTMLElement): number {
  const slot = card.querySelector("[style*='aspect-ratio']");
  const style = slot?.getAttribute("style") ?? "";
  const match = /aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(style);
  if (match) {
    const w = Number(match[1]);
    const h = Number(match[2]);
    return Math.round((GRID_COL_W * h) / w) + 80;
  }
  return TEXT_ONLY_H;
}

function readAspect(card: HTMLElement): string | null {
  const slot = card.querySelector("[style*='aspect-ratio']");
  const style = slot?.getAttribute("style") ?? "";
  const match = /aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(style);
  return match ? `${match[1]}/${match[2]}` : null;
}

function settleCoverImg(
  card: HTMLElement,
  natural: { width: number; height: number },
): void {
  const img = card.querySelector("img");
  expect(img).toBeTruthy();
  Object.defineProperty(img!, "naturalWidth", {
    configurable: true,
    value: natural.width,
  });
  Object.defineProperty(img!, "naturalHeight", {
    configurable: true,
    value: natural.height,
  });
  Object.defineProperty(img!, "complete", {
    configurable: true,
    value: true,
  });
  act(() => {
    img!.dispatchEvent(new Event("load"));
  });
}

describe("ItemGridCard cover decode must not change reserved layout (#913)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback): number => {
        queueMicrotask(() => {
          cb(0);
        });
        return 1;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("never decodes a cover <img> without a reserved aspect-ratio slot", async () => {
    // Stand class: aspect count → 0 while <img> nodes already exist, then
    // slots refill and scrollHeight grows. Decode without host WxH is forbidden.
    const { container } = render(
      <ItemGridCard
        item={stubItem("x")}
        thumbnailPath="/vault/x/cover.webp"
        thumbnailSize={undefined}
        tagsById={new Map()}
        onOpen={() => {}}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const card = container.querySelector('[role="button"]');
    expect(card).toBeTruthy();
    const imgs = card!.querySelectorAll("img");
    for (const img of imgs) {
      expect(
        readAspect(card as HTMLElement),
        "cover <img> without reserved aspect-ratio slot (CLS / scrollbar growth)",
      ).not.toBeNull();
      expect(img.getAttribute("src") || img.getAttribute("srcset")).toBeTruthy();
    }
  });

  it("keeps the same card height after the cover image settles", async () => {
    const hostSize = { width: 400, height: 300 };
    const { container } = render(
      <ItemGridCard
        item={stubItem("y")}
        thumbnailPath="/vault/y/cover.webp"
        thumbnailSize={hostSize}
        tagsById={new Map()}
        onOpen={() => {}}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const card = container.querySelector('[role="button"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(readAspect(card)).toBe("400/300");
    const heightBeforeSettle = fingerprintHeight(card);

    // Derived/display pixels often differ from host cover.size.json — settle
    // must not retarget the reserved slot (that grows the masonry scrollbar).
    settleCoverImg(card, { width: 800, height: 1200 });

    await act(async () => {
      await Promise.resolve();
    });

    expect(readAspect(card)).toBe("400/300");
    expect(fingerprintHeight(card)).toBe(heightBeforeSettle);
  });

  it("does not grow height when maps drop size mid-decode then the image settles", async () => {
    // Maps collapse / republish on folder switch: path briefly unresolved while
    // an in-flight decode still holds coverSrc — must not land as text-only
    // then jump taller when natural WxH arrives.
    const item = stubItem("z");
    const { container, rerender } = render(
      <ItemGridCard
        item={item}
        thumbnailPath="/vault/z/cover.webp"
        thumbnailSize={{ width: 360, height: 480 }}
        tagsById={new Map()}
        onOpen={() => {}}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const card = () =>
      container.querySelector('[role="button"]') as HTMLElement;
    expect(readAspect(card())).toBe("360/480");
    const heightReserved = fingerprintHeight(card());

    rerender(
      <ItemGridCard
        item={item}
        thumbnailPath={undefined}
        thumbnailSize={undefined}
        tagsById={new Map()}
        onOpen={() => {}}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    // While path is unresolved, keep the reserved slot — and keep any already
    // decoding <img> inside it (maps flicker must not wipe covers into pulse).
    const mid = card();
    expect(readAspect(mid)).toBe("360/480");
    expect(fingerprintHeight(mid)).toBe(heightReserved);
    const midImg = mid.querySelector("img");
    expect(
      midImg,
      "cover <img> wiped during maps collapse — pulse-only reserved slot",
    ).toBeTruthy();
    expect(midImg!.getAttribute("src") || midImg!.getAttribute("srcset")).toBeTruthy();

    // Path+size return; settle with unrelated natural size.
    rerender(
      <ItemGridCard
        item={item}
        thumbnailPath="/vault/z/cover.webp"
        thumbnailSize={{ width: 360, height: 480 }}
        tagsById={new Map()}
        onOpen={() => {}}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    if (card().querySelector("img")) {
      settleCoverImg(card(), { width: 100, height: 900 });
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(fingerprintHeight(card())).toBe(heightReserved);
    expect(readAspect(card())).toBe("360/480");
  });
});
