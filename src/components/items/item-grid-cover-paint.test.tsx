/**
 * #913 / #877 cover paint contract:
 * a reserved slot must not stick as pulse-only chrome — the cover must either
 * keep decoding inside the slot or finish painted (visible <img>, no pulse).
 *
 * Earlier layout tests only checked height/aspect; a vacuous "for each img"
 * loop passed when maps flicker wiped every <img> and left a gray pulse.
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

const HOST = { width: 360, height: 480 } as const;
const PATH = "/vault/paint/cover.webp";

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

function cardEl(container: HTMLElement): HTMLElement {
  const card = container.querySelector('[role="button"]');
  expect(card).toBeTruthy();
  return card as HTMLElement;
}

/** Reserved aspect with an in-flight or held <img> — not pulse-only empty chrome. */
function assertCoverDecodeAlive(card: HTMLElement): void {
  expect(
    card.querySelector("[style*='aspect-ratio']"),
    "reserved cover slot missing",
  ).toBeTruthy();
  const img = card.querySelector("img");
  expect(
    img,
    "cover <img> missing inside reserved slot (pulse-only / maps wiped decode)",
  ).toBeTruthy();
  expect(img!.getAttribute("src") || img!.getAttribute("srcset")).toBeTruthy();
}

/** Terminal painted cover: visible image, pulse overlay gone. */
function assertCoverPainted(card: HTMLElement): void {
  assertCoverDecodeAlive(card);
  expect(
    card.querySelector(".animate-pulse"),
    "cover still showing pulse after decode should have settled",
  ).toBeNull();
}

function settleCoverImg(
  card: HTMLElement,
  natural: { width: number; height: number } = { width: 100, height: 200 },
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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

type CardProps = {
  thumbnailPath: string | null | undefined;
  thumbnailSize: { width: number; height: number } | undefined;
};

function renderCard(item: ItemFile, props: CardProps) {
  return render(
    <ItemGridCard
      item={item}
      thumbnailPath={props.thumbnailPath}
      thumbnailSize={props.thumbnailSize}
      tagsById={new Map()}
      onOpen={() => {}}
    />,
  );
}

describe("ItemGridCard cover must not stick unloaded (#913/#877)", () => {
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

  it("paints the cover once path+size are stable and the image settles", async () => {
    const { container } = renderCard(stubItem("stable"), {
      thumbnailPath: PATH,
      thumbnailSize: HOST,
    });
    await flush();
    assertCoverDecodeAlive(cardEl(container));
    settleCoverImg(cardEl(container));
    await flush();
    assertCoverPainted(cardEl(container));
  });

  it("keeps decode alive while maps collapse path, then paints after recover", async () => {
    // Stand class: cover maps flicker path→undefined while WxH is latched;
    // clearing decode left reserved pulse with zero <img>.
    const item = stubItem("flicker");
    const { container, rerender } = renderCard(item, {
      thumbnailPath: PATH,
      thumbnailSize: HOST,
    });
    await flush();
    assertCoverDecodeAlive(cardEl(container));

    rerender(
      <ItemGridCard
        item={item}
        thumbnailPath={undefined}
        thumbnailSize={undefined}
        tagsById={new Map()}
        onOpen={() => {}}
      />,
    );
    await flush();
    assertCoverDecodeAlive(cardEl(container));

    rerender(
      <ItemGridCard
        item={item}
        thumbnailPath={PATH}
        thumbnailSize={HOST}
        tagsById={new Map()}
        onOpen={() => {}}
      />,
    );
    await flush();
    assertCoverDecodeAlive(cardEl(container));
    settleCoverImg(cardEl(container));
    await flush();
    assertCoverPainted(cardEl(container));
  });

  it("keeps an already-painted cover through maps path flicker", async () => {
    const item = stubItem("painted-flicker");
    const { container, rerender } = renderCard(item, {
      thumbnailPath: PATH,
      thumbnailSize: HOST,
    });
    await flush();
    settleCoverImg(cardEl(container));
    await flush();
    assertCoverPainted(cardEl(container));

    rerender(
      <ItemGridCard
        item={item}
        thumbnailPath={undefined}
        thumbnailSize={undefined}
        tagsById={new Map()}
        onOpen={() => {}}
      />,
    );
    await flush();
    // Settled paint must survive unresolved path while the slot is latched.
    assertCoverPainted(cardEl(container));

    rerender(
      <ItemGridCard
        item={item}
        thumbnailPath={PATH}
        thumbnailSize={HOST}
        tagsById={new Map()}
        onOpen={() => {}}
      />,
    );
    await flush();
    assertCoverPainted(cardEl(container));
  });

  it.each([
    {
      name: "double maps collapse",
      disrupt: async (
        item: ItemFile,
        rerender: ReturnType<typeof renderCard>["rerender"],
      ) => {
        for (let i = 0; i < 2; i += 1) {
          rerender(
            <ItemGridCard
              item={item}
              thumbnailPath={undefined}
              thumbnailSize={undefined}
              tagsById={new Map()}
              onOpen={() => {}}
            />,
          );
          await flush();
          assertCoverDecodeAlive(
            document.querySelector('[role="button"]') as HTMLElement,
          );
          rerender(
            <ItemGridCard
              item={item}
              thumbnailPath={PATH}
              thumbnailSize={HOST}
              tagsById={new Map()}
              onOpen={() => {}}
            />,
          );
          await flush();
        }
      },
    },
    {
      name: "null cover then path returns",
      disrupt: async (
        item: ItemFile,
        rerender: ReturnType<typeof renderCard>["rerender"],
      ) => {
        // null = known empty; must not sticky-pulse. Then a real path returns.
        rerender(
          <ItemGridCard
            item={item}
            thumbnailPath={null}
            thumbnailSize={undefined}
            tagsById={new Map()}
            onOpen={() => {}}
          />,
        );
        await flush();
        const empty = document.querySelector('[role="button"]') as HTMLElement;
        expect(empty.querySelector(".animate-pulse")).toBeNull();
        rerender(
          <ItemGridCard
            item={item}
            thumbnailPath={PATH}
            thumbnailSize={HOST}
            tagsById={new Map()}
            onOpen={() => {}}
          />,
        );
        await flush();
      },
    },
  ])(
    "reaches painted cover after disruption: $name",
    async ({ name, disrupt }) => {
      const item = stubItem(`disrupt-${name}`);
      const { container, rerender } = renderCard(item, {
        thumbnailPath: PATH,
        thumbnailSize: HOST,
      });
      await flush();
      assertCoverDecodeAlive(cardEl(container));

      await disrupt(item, rerender);

      assertCoverDecodeAlive(cardEl(container));
      settleCoverImg(cardEl(container));
      await flush();
      assertCoverPainted(cardEl(container));
    },
  );
});
