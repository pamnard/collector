import { describe, expect, it } from "vitest";
import { DISK_ITEM_READ_CONCURRENCY } from "@collector/core";
import { downloadCdnMediaIntents } from "./download-cdn-media-intents.js";

describe("downloadCdnMediaIntents", () => {
  it("returns empty array for empty intents", async () => {
    const files = await downloadCdnMediaIntents([], async () => {
      throw new Error("download must not run for empty intents");
    });
    expect(files).toEqual([]);
  });

  it("keeps attach order by intent index when downloads finish out of order", async () => {
    const releases: Array<() => void> = [];
    const gates = [0, 1, 2].map(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const intents = [
      { sourceUrl: "https://cdn.example/a.jpg", filename: "0-a.jpg" },
      { sourceUrl: "https://cdn.example/b.jpg", filename: "1-b.jpg" },
      { sourceUrl: "https://cdn.example/c.jpg", filename: "2-c.jpg" },
    ];
    const indexByUrl = new Map(
      intents.map((intent, index) => [intent.sourceUrl, index]),
    );

    const pending = downloadCdnMediaIntents(intents, async (sourceUrl) => {
      const index = indexByUrl.get(sourceUrl);
      if (index === undefined) {
        throw new Error(`unexpected url ${sourceUrl}`);
      }
      await gates[index];
      return new TextEncoder().encode(`bytes-${index}`);
    });

    // Finish in reverse order: last intent first.
    releases[2]!();
    releases[1]!();
    releases[0]!();

    const files = await pending;
    expect(files.map((file) => file.name)).toEqual([
      "0-a.jpg",
      "1-b.jpg",
      "2-c.jpg",
    ]);
    expect(new TextDecoder().decode(files[0]!.bytes)).toBe("bytes-0");
    expect(new TextDecoder().decode(files[1]!.bytes)).toBe("bytes-1");
    expect(new TextDecoder().decode(files[2]!.bytes)).toBe("bytes-2");
  });

  it("runs downloads with bounded concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const releaseAll: Array<() => void> = [];
    const started = Array.from({ length: 8 }, () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      releaseAll.push(release);
      return gate;
    });

    const pending = downloadCdnMediaIntents(
      started.map((_, index) => ({
        sourceUrl: `https://cdn.example/${index}.jpg`,
        filename: `${index}.jpg`,
      })),
      async (sourceUrl) => {
        const index = Number(sourceUrl.split("/").pop()!.replace(".jpg", ""));
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await started[index];
        inFlight -= 1;
        return new Uint8Array([index]);
      },
    );

    // Let workers start up to the concurrency cap before releasing any gate.
    await Promise.resolve();
    await Promise.resolve();
    expect(maxInFlight).toBe(DISK_ITEM_READ_CONCURRENCY);

    for (const release of releaseAll) {
      release();
    }
    const files = await pending;
    expect(files).toHaveLength(8);
    expect(maxInFlight).toBe(DISK_ITEM_READ_CONCURRENCY);
  });

  it("fails loud when any download rejects", async () => {
    await expect(
      downloadCdnMediaIntents(
        [
          { sourceUrl: "https://cdn.example/ok.jpg", filename: "ok.jpg" },
          { sourceUrl: "https://cdn.example/bad.jpg", filename: "bad.jpg" },
        ],
        async (sourceUrl) => {
          if (sourceUrl.includes("bad")) {
            throw new Error("cdn boom");
          }
          return new Uint8Array([1]);
        },
      ),
    ).rejects.toThrow("cdn boom");
  });
});
