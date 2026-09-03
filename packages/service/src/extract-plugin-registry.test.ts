/**
 * Extract plugin registry — real vault notes + Instagram fixture HTTP
 * (not discoverCalls / extractCalls theater). Assert candidates + vault writes.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtractorPlugin } from "@collector/api";
import {
  SqlVaultIndexStore,
  attachMediaFile,
  createVault,
  listItemMediaWithPaths,
  readItemFile,
  readItemRawMarkdown,
  resolveOrCreateInboxFolder,
  upsertItem,
  type VaultContext,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import {
  INSTAGRAM_PLUGIN_ID,
  createInstagramExtractorPlugin,
} from "./extract/instagram/instagram-extractor-plugin.js";
import {
  PINTEREST_PLUGIN_ID,
  createPinterestExtractorPlugin,
} from "./extract/pinterest/pinterest-extractor-plugin.js";
import { createExtractPluginRegistry } from "./extract-plugin-registry.js";
import { createItemsCrud } from "./items-crud.js";

const FRONTMATTER_PROBE_ID = "frontmatter-probe";
const FRONTMATTER_PROBE_URL = "https://probe.example/from-frontmatter";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "extract/instagram/fixtures",
);
const PINTEREST_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "extract/pinterest/fixtures",
);

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const OK_SHORTCODE = "CxImage01ab";
const OK_URL = `https://www.instagram.com/p/${OK_SHORTCODE}/`;
const OK_PIN_ID = "111222333444";
const OK_PIN_URL = `https://www.pinterest.com/pin/${OK_PIN_ID}/`;

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function readPinterestFixture(name: string): string {
  return readFileSync(join(PINTEREST_FIXTURES, name), "utf8");
}

const SINGLE_EMBED_HTML = readFixture("single-image-embed.html");
const SINGLE_PIN_HTML = readPinterestFixture("single-image-pin.html");

/** Fixture-backed Instagram HTTP — no network. */
function createFixtureFetch(): typeof fetch {
  return async (input) => {
    const url = String(input);

    if (url.includes(`/${OK_SHORTCODE}/embed/`)) {
      return new Response(SINGLE_EMBED_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.includes("cdn.instagram.fixture/single.jpg")) {
      return new Response(JPEG, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }

    throw new Error(
      `unexpected URL in extract-plugin-registry fixture fetch: ${url}`,
    );
  };
}

function createPinterestFixtureFetch(): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes(`/pin/${OK_PIN_ID}/`) && !url.includes("PinResource")) {
      return new Response(SINGLE_PIN_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.includes("cdn.pinterest.fixture/single.jpg")) {
      return new Response(JPEG, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    throw new Error(
      `unexpected URL in extract-plugin-registry pinterest fixture fetch: ${url}`,
    );
  };
}

describe("createExtractPluginRegistry (#849 / #899)", () => {
  const dirs: string[] = [];
  const fs = new NodeFileSystemAdapter();

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function openHarness(input: {
    body: string;
    url?: string | null;
    catalog?: "instagram" | "pinterest" | "empty" | "frontmatter-probe";
  }): Promise<{
    registry: ReturnType<typeof createExtractPluginRegistry>;
    itemId: string;
    vaultPath: string;
    vaultId: string;
    ctx: VaultContext;
  }> {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-extract-reg-"));
    dirs.push(dataDir);
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx: VaultContext = { fs, index };
    const { meta: vault, path: vaultPath } = await createVault(ctx, dataDir, {
      name: "Vault",
    });
    const folderPath = await resolveOrCreateInboxFolder(ctx, vaultPath);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;
    const now = new Date().toISOString();

    await upsertItem(ctx, vaultPath, vault.id, {
      item: {
        id: itemId,
        vault_id: vault.id,
        title: "Capture",
        description: "",
        url: input.url ?? null,
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: folderPath,
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: now,
        updated_at: now,
      },
      content: input.body,
    });

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path: vaultPath, vault }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
      } as never,
      () => "unused",
    );

    const attachFiles = async (
      id: string,
      files: { name: string; bytes: Uint8Array }[],
    ) => {
      const out = [];
      for (const file of files) {
        out.push(
          await attachMediaFile(ctx, vaultPath, id, {
            filename: file.name,
            data: file.bytes,
          }),
        );
      }
      return out;
    };

    const mode = input.catalog ?? "instagram";
    let catalog: ExtractorPlugin[] = [];
    if (mode === "instagram") {
      catalog = [
        createInstagramExtractorPlugin({
          getItemById: (id) => crud.getItemById(id),
          updateItem: (id, patch) => crud.updateItem(id, patch),
          attachMediaFiles: attachFiles,
          fetchImpl: createFixtureFetch(),
        }),
      ];
    } else if (mode === "pinterest") {
      catalog = [
        createPinterestExtractorPlugin({
          getItemById: (id) => crud.getItemById(id),
          updateItem: (id, patch) => crud.updateItem(id, patch),
          attachMediaFiles: attachFiles,
          fetchImpl: createPinterestFixtureFetch(),
        }),
      ];
    } else if (mode === "frontmatter-probe") {
      // Instagram ignores frontmatter url by design; probe asserts registry passthrough.
      catalog = [
        {
          id: FRONTMATTER_PROBE_ID,
          discover({ frontmatterUrl }) {
            if (frontmatterUrl !== FRONTMATTER_PROBE_URL) {
              return [];
            }
            return [
              {
                extractorId: FRONTMATTER_PROBE_ID,
                url: FRONTMATTER_PROBE_URL,
                meta: { source: "frontmatter" },
              },
            ];
          },
          async extract({ itemId: id }) {
            await crud.updateItem(id, { title: "probed-from-frontmatter" });
          },
        },
      ];
    }

    const registry = createExtractPluginRegistry({
      getItemById: (id) => crud.getItemById(id),
      createCatalog: () => catalog,
    });

    return {
      registry,
      itemId,
      vaultPath,
      vaultId: vault.id,
      ctx,
    };
  }

  it("default catalog is empty", async () => {
    const h = await openHarness({
      body: `see ${OK_URL}\n`,
      catalog: "empty",
    });

    await expect(
      h.registry.discoverExtractCandidates(h.itemId),
    ).resolves.toEqual([]);
  });

  it("discover merges Instagram candidates from vault body", async () => {
    const h = await openHarness({
      body: `link ${OK_URL} here\n`,
    });

    const candidates = await h.registry.discoverExtractCandidates(h.itemId);
    expect(candidates).toEqual([
      {
        extractorId: INSTAGRAM_PLUGIN_ID,
        url: OK_URL,
        meta: { shortcode: OK_SHORTCODE },
      },
    ]);
  });

  it("discover passes vault frontmatter url into catalog plugins", async () => {
    const h = await openHarness({
      body: "no probe URL in body\n",
      url: FRONTMATTER_PROBE_URL,
      catalog: "frontmatter-probe",
    });

    const candidates = await h.registry.discoverExtractCandidates(h.itemId);
    expect(candidates).toEqual([
      {
        extractorId: FRONTMATTER_PROBE_ID,
        url: FRONTMATTER_PROBE_URL,
        meta: { source: "frontmatter" },
      },
    ]);

    await h.registry.extractItemCandidate(h.itemId, candidates[0]!);
    const item = await readItemFile(fs, h.vaultPath, h.itemId, h.vaultId);
    expect(item.title).toBe("probed-from-frontmatter");
  });

  it("extract writes Instagram fixture into vault note + media", async () => {
    const h = await openHarness({
      body: `Keep preamble\n\n${OK_URL}\n`,
    });
    const candidates = await h.registry.discoverExtractCandidates(h.itemId);
    expect(candidates).toHaveLength(1);

    await h.registry.extractItemCandidate(h.itemId, candidates[0]!);

    const item = await readItemFile(fs, h.vaultPath, h.itemId, h.vaultId);
    expect(item.title).toBe("Morning ride");
    expect(item.url).toBe(OK_URL);

    const raw = await readItemRawMarkdown(fs, h.vaultPath, h.itemId);
    expect(raw).toContain("Keep preamble");
    expect(raw).toContain("Morning ride");
    const body = raw.replace(/^---[\s\S]*?---\n/, "");
    expect(body).not.toContain(OK_URL);

    const media = await listItemMediaWithPaths(h.ctx, h.vaultPath, h.itemId);
    expect(media).toHaveLength(1);
    expect(media[0]!.filename).toBe(`${OK_SHORTCODE}.jpg`);
    expect(await fs.exists(media[0]!.absolute_path)).toBe(true);
    expect(await fs.readBinary(media[0]!.absolute_path)).toEqual(JPEG);
  });

  it("extract writes Pinterest fixture into vault note + media (#34)", async () => {
    const h = await openHarness({
      body: `Keep preamble\n\n${OK_PIN_URL}\n`,
      catalog: "pinterest",
    });
    const candidates = await h.registry.discoverExtractCandidates(h.itemId);
    expect(candidates).toEqual([
      {
        extractorId: PINTEREST_PLUGIN_ID,
        url: OK_PIN_URL,
        meta: { shortcode: OK_PIN_ID },
      },
    ]);

    await h.registry.extractItemCandidate(h.itemId, candidates[0]!);

    const item = await readItemFile(fs, h.vaultPath, h.itemId, h.vaultId);
    expect(item.title).toBe("Morning ride");
    expect(item.url).toBe(OK_PIN_URL);

    const raw = await readItemRawMarkdown(fs, h.vaultPath, h.itemId);
    expect(raw).toContain("Keep preamble");
    const body = raw.replace(/^---[\s\S]*?---\n/, "");
    expect(body).not.toContain(OK_PIN_URL);

    const media = await listItemMediaWithPaths(h.ctx, h.vaultPath, h.itemId);
    expect(media).toHaveLength(1);
    expect(media[0]!.filename).toBe(`${OK_PIN_ID}-1.jpg`);
    expect(await fs.exists(media[0]!.absolute_path)).toBe(true);
    expect(await fs.readBinary(media[0]!.absolute_path)).toEqual(JPEG);
  });

  it("unknown extractorId fails loudly", async () => {
    const h = await openHarness({ body: "plain\n" });

    await expect(
      h.registry.extractItemCandidate(h.itemId, {
        extractorId: "nope",
        url: "https://example.com/x",
      }),
    ).rejects.toThrow(/Unknown extractor/);
  });
});
