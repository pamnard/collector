import { describe, expect, it, vi } from "vitest";
import type { ExtractCandidate } from "@collector/api";
import { itemExtractAutoJobType } from "@collector/shared";
import { EXTRACT_AUTO_METADATA_KEY } from "../../extract/extract-auto-metadata.js";
import { createItemExtractAutoHandler } from "./item-extract-auto.js";

function igCandidate(shortcode: string): ExtractCandidate {
  return {
    extractorId: "instagram",
    url: `https://www.instagram.com/reel/${shortcode}/`,
    meta: { shortcode },
  };
}

describe("createItemExtractAutoHandler", () => {
  const baseItem = {
    id: "Inbox/n.md",
    metadata: {} as Record<string, unknown>,
  };

  it("no-ops when discover is empty", async () => {
    const extractItemCandidate = vi.fn();
    const updateItem = vi.fn();
    const jobPermanentFailure = { notify: vi.fn() };
    const handler = createItemExtractAutoHandler({
      getItemById: async () => ({ item: baseItem, content: "" }),
      updateItem,
      discoverExtractCandidates: async () => [],
      extractItemCandidate,
      jobPermanentFailure,
    });

    const result = await handler({
      id: "job-1",
      type: itemExtractAutoJobType.id,
      payload: {
        vaultId: "v1",
        vaultPath: "/vault",
        itemId: "Inbox/n.md",
        contentRevision: 1,
      },
    } as never);

    expect(result).toEqual({ status: "ok" });
    expect(extractItemCandidate).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
    expect(jobPermanentFailure.notify).not.toHaveBeenCalled();
  });

  it("marks ok after successful extract", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
    const candidate = igCandidate("OkCode");
    const extractItemCandidate = vi.fn(async () => undefined);
    const updateItem = vi.fn(async () => baseItem);
    const handler = createItemExtractAutoHandler({
      getItemById: async () => ({
        item: { ...baseItem, metadata: {} },
        content: candidate.url,
      }),
      updateItem,
      discoverExtractCandidates: async () => [candidate],
      extractItemCandidate,
      jobPermanentFailure: { notify: vi.fn() },
    });

    await handler({
      id: "job-ok",
      type: itemExtractAutoJobType.id,
      payload: {
        vaultId: "v1",
        vaultPath: "/vault",
        itemId: "Inbox/n.md",
        contentRevision: 1,
      },
    } as never);

    expect(extractItemCandidate).toHaveBeenCalledWith("Inbox/n.md", candidate);
    expect(updateItem).toHaveBeenCalledWith("Inbox/n.md", {
      metadata: {
        [EXTRACT_AUTO_METADATA_KEY]: {
          OkCode: {
            attempted_at: "2026-08-26T12:00:00.000Z",
            ok: true,
          },
        },
      },
    });
    vi.useRealTimers();
  });

  it("marks fail once and reports permanent failure without rethrow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
    const candidate = igCandidate("FailCode");
    const extractItemCandidate = vi.fn(async () => {
      throw new Error("cdn 403");
    });
    const updateItem = vi.fn(async () => baseItem);
    const notify = vi.fn();
    const handler = createItemExtractAutoHandler({
      getItemById: async () => ({
        item: { ...baseItem, metadata: {} },
        content: candidate.url,
      }),
      updateItem,
      discoverExtractCandidates: async () => [candidate],
      extractItemCandidate,
      jobPermanentFailure: { notify },
    });

    const result = await handler({
      id: "job-fail",
      type: itemExtractAutoJobType.id,
      payload: {
        vaultId: "v1",
        vaultPath: "/vault",
        itemId: "Inbox/n.md",
        contentRevision: 1,
      },
    } as never);

    expect(result).toEqual({ status: "ok" });
    expect(updateItem).toHaveBeenCalledWith("Inbox/n.md", {
      metadata: {
        [EXTRACT_AUTO_METADATA_KEY]: {
          FailCode: {
            attempted_at: "2026-08-26T12:00:00.000Z",
            ok: false,
            error: "cdn 403",
          },
        },
      },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "itemExtractAuto",
        attempts: 1,
        error: expect.stringContaining("FailCode"),
      }),
    );
    expect(notify.mock.calls[0]?.[0].error).toContain("Inbox/n.md");
    vi.useRealTimers();
  });

  it("skips already-marked shortcodes (no auto-retry)", async () => {
    const candidate = igCandidate("Tried");
    const extractItemCandidate = vi.fn();
    const handler = createItemExtractAutoHandler({
      getItemById: async () => ({
        item: {
          ...baseItem,
          metadata: {
            [EXTRACT_AUTO_METADATA_KEY]: {
              Tried: {
                attempted_at: "2026-01-01T00:00:00.000Z",
                ok: false,
                error: "prev",
              },
            },
          },
        },
        content: candidate.url,
      }),
      updateItem: vi.fn(),
      discoverExtractCandidates: async () => [candidate],
      extractItemCandidate,
      jobPermanentFailure: { notify: vi.fn() },
    });

    await handler({
      id: "job-skip",
      type: itemExtractAutoJobType.id,
      payload: {
        vaultId: "v1",
        vaultPath: "/vault",
        itemId: "Inbox/n.md",
        contentRevision: 1,
      },
    } as never);

    expect(extractItemCandidate).not.toHaveBeenCalled();
  });

  it("tries all untried shortcodes independently", async () => {
    const a = igCandidate("Aaa");
    const b = igCandidate("Bbb");
    const extractItemCandidate = vi.fn(async (_id, candidate: ExtractCandidate) => {
      if (candidate.meta?.shortcode === "Aaa") {
        throw new Error("a failed");
      }
    });
    const updateItem = vi.fn(async () => baseItem);
    const notify = vi.fn();
    const handler = createItemExtractAutoHandler({
      getItemById: async () => ({
        item: { ...baseItem, metadata: {} },
        content: `${a.url}\n${b.url}`,
      }),
      updateItem,
      discoverExtractCandidates: async () => [a, b],
      extractItemCandidate,
      jobPermanentFailure: { notify },
    });

    await handler({
      id: "job-multi",
      type: itemExtractAutoJobType.id,
      payload: {
        vaultId: "v1",
        vaultPath: "/vault",
        itemId: "Inbox/n.md",
        contentRevision: 1,
      },
    } as never);

    expect(extractItemCandidate).toHaveBeenCalledTimes(2);
    expect(updateItem).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);
    const metas = updateItem.mock.calls.map(
      (call) =>
        (call[1] as { metadata: Record<string, unknown> }).metadata[
          EXTRACT_AUTO_METADATA_KEY
        ] as Record<string, { ok: boolean }>,
    );
    expect(metas.some((m) => m.Aaa?.ok === false)).toBe(true);
    expect(metas.some((m) => m.Bbb?.ok === true)).toBe(true);
  });
});
