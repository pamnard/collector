import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  COVER_DECODE_PORTRAIT_RATIO,
  COVER_DECODE_ROOT_MARGIN,
  COVER_IMG_LOADING_PRIORITY,
  applyCoverDecodeFail,
  applyCoverDecodeLoad,
  isCoverImgEventForSrc,
  isPortraitCoverNaturalSize,
  itemGridCardMemoSnapshot,
  itemGridCardMemoSnapshotsEqual,
  shouldAttachCoverSrc,
  shouldObserveNearViewport,
  shouldRunCoverDecodeTimeout,
} from "./item-grid-cover-decode.ts";

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
    assert.equal(
      shouldAttachCoverSrc({
        nearViewport: false,
        decodedCoverSrc: null,
        expectedCoverSrc: "/covers/a.webp",
      }),
      false,
    );
  });

  it("attaches when the card is near the masonry scrollport", () => {
    assert.equal(
      shouldAttachCoverSrc({
        nearViewport: true,
        decodedCoverSrc: null,
        expectedCoverSrc: "/covers/a.webp",
      }),
      true,
    );
  });

  it("keeps a decoded cover attached after it leaves the viewport", () => {
    assert.equal(
      shouldAttachCoverSrc({
        nearViewport: false,
        decodedCoverSrc: "/covers/a.webp",
        expectedCoverSrc: "/covers/a.webp",
      }),
      true,
    );
  });

  it("does not keep a stale decoded src after the expected cover changes", () => {
    assert.equal(
      shouldAttachCoverSrc({
        nearViewport: false,
        decodedCoverSrc: "/covers/a.webp",
        expectedCoverSrc: "/covers/b.webp",
      }),
      false,
    );
  });

  it("never attaches when there is no expected cover src", () => {
    assert.equal(
      shouldAttachCoverSrc({
        nearViewport: true,
        decodedCoverSrc: null,
        expectedCoverSrc: null,
      }),
      false,
    );
  });
});

describe("shouldRunCoverDecodeTimeout", () => {
  it("runs only while a near-viewport cover is decoding", () => {
    assert.equal(
      shouldRunCoverDecodeTimeout({
        attachCover: true,
        coverSettled: false,
        expectedCoverSrc: "/covers/a.webp",
      }),
      true,
    );
  });

  it("does not time out an offscreen deferred cover", () => {
    assert.equal(
      shouldRunCoverDecodeTimeout({
        attachCover: false,
        coverSettled: false,
        expectedCoverSrc: "/covers/a.webp",
      }),
      false,
    );
  });
});

describe("shouldObserveNearViewport", () => {
  it("does not observe until both the card node and scroll root exist", () => {
    const node = { id: "card" };
    const root = { id: "scroll" };
    assert.equal(
      shouldObserveNearViewport({ node: null, root: root as unknown as Element }),
      false,
    );
    assert.equal(
      shouldObserveNearViewport({ node: node as unknown as Element, root: null }),
      false,
    );
    assert.equal(
      shouldObserveNearViewport({
        node: node as unknown as Element,
        root: root as unknown as Element,
      }),
      true,
    );
  });
});

describe("cover decode flight", () => {
  it("accepts a load only for the current expected src and flight", () => {
    assert.deepEqual(
      applyCoverDecodeLoad({
        flightId: 2,
        eventFlightId: 2,
        expectedSrc: "/covers/b.webp",
        imgSrcAttr: "/covers/b.webp",
        width: 100,
        height: 200,
      }),
      { coverSrc: "/covers/b.webp", isPortrait: true },
    );
  });

  it("ignores a stale load from a previous cover src", () => {
    assert.equal(
      applyCoverDecodeLoad({
        flightId: 2,
        eventFlightId: 1,
        expectedSrc: "/covers/b.webp",
        imgSrcAttr: "/covers/a.webp",
        width: 100,
        height: 200,
      }),
      null,
    );
    assert.equal(
      isCoverImgEventForSrc("/covers/a.webp", "/covers/b.webp"),
      false,
    );
  });

  it("ignores a stale timeout or error after the src changes", () => {
    assert.equal(
      applyCoverDecodeFail({ flightId: 2, eventFlightId: 1 }),
      null,
    );
    assert.deepEqual(applyCoverDecodeFail({ flightId: 2, eventFlightId: 2 }), {
      coverSrc: null,
      isPortrait: false,
    });
  });
});

describe("isPortraitCoverNaturalSize", () => {
  it("treats zero width as not portrait", () => {
    assert.equal(isPortraitCoverNaturalSize(0, 100), false);
  });

  it("matches the 1.2 dominant-ratio used by collection covers", () => {
    assert.equal(isPortraitCoverNaturalSize(100, 120), true);
    assert.equal(isPortraitCoverNaturalSize(100, 119), false);
    assert.equal(COVER_DECODE_PORTRAIT_RATIO, 1.2);
    const form = readFileSync(
      join(here, "../../lib/teaser-layout/cover-image-form.ts"),
      "utf8",
    );
    assert.match(form, /export const COVER_DOMINANT_RATIO = 1\.2/);
  });
});

describe("itemGridCardMemoSnapshotsEqual", () => {
  it("treats the same id + stamp + thumb path as equal when display fields match", () => {
    assert.equal(
      itemGridCardMemoSnapshotsEqual(memoSnapshot(), memoSnapshot()),
      true,
    );
  });

  it("invalidates when the thumb path or cover stamp changes", () => {
    const base = memoSnapshot();
    assert.equal(
      itemGridCardMemoSnapshotsEqual(
        base,
        memoSnapshot({ thumbnailPath: "/covers/b.webp" }),
      ),
      false,
    );
    assert.equal(
      itemGridCardMemoSnapshotsEqual(
        base,
        memoSnapshot({ coverStamp: "a.webp:2026-02-01T00:00:00.000Z" }),
      ),
      false,
    );
  });

  it("invalidates when title changes so memo does not hide edits", () => {
    assert.equal(
      itemGridCardMemoSnapshotsEqual(
        memoSnapshot(),
        memoSnapshot({ title: "B" }),
      ),
      false,
    );
  });
});

describe("cover decode constants", () => {
  it("uses eager loading only for the attached (priority) img", () => {
    assert.equal(COVER_IMG_LOADING_PRIORITY, "eager");
  });

  it("prefetches a band above and below the scrollport", () => {
    assert.match(COVER_DECODE_ROOT_MARGIN, /400px/);
  });
});

describe("masonry + single decode path guards (#660)", () => {
  it("keeps react-masonry-css, .my-masonry-grid, and MASONRY_BREAKPOINTS", () => {
    const view = readFileSync(join(here, "ItemGridView.tsx"), "utf8");
    assert.match(view, /from "react-masonry-css"/);
    assert.match(view, /breakpointCols=\{MASONRY_BREAKPOINTS\}/);
    assert.match(view, /className="my-masonry-grid"/);
    assert.match(view, /columnClassName="my-masonry-grid_column"/);
  });

  it("does not preload covers with new Image() (displayed img is the only decode)", () => {
    const hook = readFileSync(join(here, "use-item-grid-cover.ts"), "utf8");
    assert.doesNotMatch(hook, /new Image\s*\(/);
  });

  it("gates card decode on near-viewport and uses the displayed img loading attr", () => {
    const card = readFileSync(join(here, "ItemGridCard.tsx"), "utf8");
    assert.match(card, /useNearViewport/);
    assert.match(card, /decodePriority:\s*nearViewport/);
    assert.match(card, /COVER_IMG_LOADING_PRIORITY/);
  });
});
