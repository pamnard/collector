import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COVER_DECODE_ROOT_MARGIN,
  COVER_IMG_LOADING_PRIORITY,
  isPortraitCoverNaturalSize,
  itemGridCardMemoSnapshot,
  itemGridCardMemoSnapshotsEqual,
  shouldAttachCoverSrc,
  shouldRunCoverDecodeTimeout,
} from "./item-grid-cover-decode";

const here = dirname(fileURLToPath(import.meta.url));

function memoSnapshot(
  overrides: Partial<Parameters<typeof itemGridCardMemoSnapshot>[0]> = {},
) {
  return itemGridCardMemoSnapshot({
    id: "inbox/a.md",
    coverStamp: "a.webp:2026-01-01T00:00:00.000Z",
    thumbnailPath: "/covers/a.webp",
    title: "A",
    description: "",
    contentType: "image",
    createdAt: "2026-01-01T00:00:00.000Z",
    url: null,
    tagIds: [],
    ...overrides,
  });
}

describe("shouldAttachCoverSrc", () => {
  it("does not attach an offscreen unsettled cover (no eager decode)", () => {
    expect(
      shouldAttachCoverSrc({
        nearViewport: false,
        decodedCoverSrc: null,
        expectedCoverSrc: "/covers/a.webp",
      }),
    ).toBe(false);
  });

  it("attaches when the card is near the masonry scrollport", () => {
    expect(
      shouldAttachCoverSrc({
        nearViewport: true,
        decodedCoverSrc: null,
        expectedCoverSrc: "/covers/a.webp",
      }),
    ).toBe(true);
  });

  it("keeps a decoded cover attached after it leaves the viewport", () => {
    expect(
      shouldAttachCoverSrc({
        nearViewport: false,
        decodedCoverSrc: "/covers/a.webp",
        expectedCoverSrc: "/covers/a.webp",
      }),
    ).toBe(true);
  });

  it("never attaches when there is no expected cover src", () => {
    expect(
      shouldAttachCoverSrc({
        nearViewport: true,
        decodedCoverSrc: null,
        expectedCoverSrc: null,
      }),
    ).toBe(false);
  });
});

describe("shouldRunCoverDecodeTimeout", () => {
  it("runs only while a near-viewport cover is decoding", () => {
    expect(
      shouldRunCoverDecodeTimeout({
        attachCover: true,
        coverSettled: false,
        expectedCoverSrc: "/covers/a.webp",
      }),
    ).toBe(true);
  });

  it("does not time out an offscreen deferred cover", () => {
    expect(
      shouldRunCoverDecodeTimeout({
        attachCover: false,
        coverSettled: false,
        expectedCoverSrc: "/covers/a.webp",
      }),
    ).toBe(false);
  });
});

describe("isPortraitCoverNaturalSize", () => {
  it("treats zero width as not portrait", () => {
    expect(isPortraitCoverNaturalSize(0, 100)).toBe(false);
  });

  it("matches the 1.2 dominant-ratio used by collection covers", () => {
    expect(isPortraitCoverNaturalSize(100, 120)).toBe(true);
    expect(isPortraitCoverNaturalSize(100, 119)).toBe(false);
  });
});

describe("itemGridCardMemoSnapshotsEqual", () => {
  it("treats the same id + stamp + thumb path as equal when display fields match", () => {
    expect(
      itemGridCardMemoSnapshotsEqual(memoSnapshot(), memoSnapshot()),
    ).toBe(true);
  });

  it("invalidates when the thumb path or cover stamp changes", () => {
    const base = memoSnapshot();
    expect(
      itemGridCardMemoSnapshotsEqual(
        base,
        memoSnapshot({ thumbnailPath: "/covers/b.webp" }),
      ),
    ).toBe(false);
    expect(
      itemGridCardMemoSnapshotsEqual(
        base,
        memoSnapshot({ coverStamp: "a.webp:2026-02-01T00:00:00.000Z" }),
      ),
    ).toBe(false);
  });

  it("invalidates when title changes so memo does not hide edits", () => {
    expect(
      itemGridCardMemoSnapshotsEqual(
        memoSnapshot(),
        memoSnapshot({ title: "B" }),
      ),
    ).toBe(false);
  });
});

describe("cover decode constants", () => {
  it("uses eager loading only for the attached (priority) img", () => {
    expect(COVER_IMG_LOADING_PRIORITY).toBe("eager");
  });

  it("prefetches a band above and below the scrollport", () => {
    expect(COVER_DECODE_ROOT_MARGIN).toMatch(/400px/);
  });
});

describe("masonry + single decode path guards (#660)", () => {
  it("keeps react-masonry-css, .my-masonry-grid, and MASONRY_BREAKPOINTS", () => {
    const view = readFileSync(join(here, "ItemGridView.tsx"), "utf8");
    expect(view).toMatch(/from "react-masonry-css"/);
    expect(view).toMatch(/breakpointCols=\{MASONRY_BREAKPOINTS\}/);
    expect(view).toMatch(/className="my-masonry-grid"/);
    expect(view).toMatch(/columnClassName="my-masonry-grid_column"/);
  });

  it("does not preload covers with new Image() (displayed img is the only decode)", () => {
    const hook = readFileSync(join(here, "use-item-grid-cover.ts"), "utf8");
    expect(hook).not.toMatch(/new Image\s*\(/);
  });

  it("gates card decode on near-viewport and uses the displayed img loading attr", () => {
    const card = readFileSync(join(here, "ItemGridCard.tsx"), "utf8");
    expect(card).toMatch(/useNearViewport/);
    expect(card).toMatch(/decodePriority:\s*nearViewport/);
    expect(card).toMatch(/COVER_IMG_LOADING_PRIORITY/);
  });
});
