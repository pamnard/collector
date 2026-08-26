import { describe, expect, it, vi } from "vitest";
import type { GetItemResult } from "@collector/api";
import { createExtractPluginRegistry } from "./extract-plugin-registry.js";
import {
  createMockExtractorPlugin,
  MOCK_EXTRACT_MARKER_URL,
  MOCK_EXTRACTOR_ID,
} from "./extract-plugin-mock.js";

function fakeNote(input: {
  id?: string;
  body: string;
  url?: string | null;
}): GetItemResult {
  const id = input.id ?? "Inbox/note.md";
  return {
    item: {
      id,
      vault_id: "vault-1",
      title: "Note",
      description: "",
      url: input.url ?? null,
      content_type: "note",
      source_type: "manual",
      metadata: {},
      properties: {},
      thumbnail: null,
      tag_ids: [],
      collection_ids: [],
      folder_path: "Inbox",
      content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-01-01T00:00:00.000Z",
    },
    content: input.body,
  };
}

describe("createExtractPluginRegistry (#849)", () => {
  it("default catalog is empty", async () => {
    const getItemById = vi.fn(async () =>
      fakeNote({ body: `see ${MOCK_EXTRACT_MARKER_URL}` }),
    );
    const registry = createExtractPluginRegistry({ getItemById });
    await expect(
      registry.discoverExtractCandidates("Inbox/note.md"),
    ).resolves.toEqual([]);
    expect(getItemById).toHaveBeenCalledWith("Inbox/note.md");
  });

  it("discover merges mock candidates from body", async () => {
    const mock = createMockExtractorPlugin();
    const registry = createExtractPluginRegistry({
      getItemById: async () =>
        fakeNote({ body: `link ${MOCK_EXTRACT_MARKER_URL} here` }),
      createCatalog: () => [mock],
    });

    const candidates = await registry.discoverExtractCandidates("Inbox/a.md");
    expect(candidates).toEqual([
      {
        extractorId: MOCK_EXTRACTOR_ID,
        url: MOCK_EXTRACT_MARKER_URL,
        meta: { source: "body" },
      },
    ]);
    expect(mock.discoverCalls).toHaveLength(1);
  });

  it("discover uses frontmatter url when present", async () => {
    const mock = createMockExtractorPlugin();
    const registry = createExtractPluginRegistry({
      getItemById: async () =>
        fakeNote({
          body: "no marker in body",
          url: MOCK_EXTRACT_MARKER_URL,
        }),
      createCatalog: () => [mock],
    });

    const candidates = await registry.discoverExtractCandidates("Inbox/a.md");
    expect(candidates).toEqual([
      {
        extractorId: MOCK_EXTRACTOR_ID,
        url: MOCK_EXTRACT_MARKER_URL,
        meta: { source: "frontmatter" },
      },
    ]);
  });

  it("extract invokes matching mock plugin", async () => {
    const mock = createMockExtractorPlugin();
    const registry = createExtractPluginRegistry({
      getItemById: vi.fn(),
      createCatalog: () => [mock],
    });
    const candidate = {
      extractorId: MOCK_EXTRACTOR_ID,
      url: MOCK_EXTRACT_MARKER_URL,
    };

    await registry.extractItemCandidate("Inbox/a.md", candidate);
    expect(mock.extractCalls).toEqual([
      { itemId: "Inbox/a.md", candidate },
    ]);
  });

  it("unknown extractorId fails loudly", async () => {
    const registry = createExtractPluginRegistry({
      getItemById: vi.fn(),
      createCatalog: () => [createMockExtractorPlugin()],
    });

    await expect(
      registry.extractItemCandidate("Inbox/a.md", {
        extractorId: "nope",
        url: "https://example.com/x",
      }),
    ).rejects.toThrow(/Unknown extractor/);
  });
});
