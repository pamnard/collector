/**
 * itemExtractAuto handler — vault + Instagram fixtures (not discover/extract/update theater).
 * Queue coalesce stays real; body of work asserts note fields + media on disk.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
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
import {
  itemExtractAutoJobType,
  type ItemExtractAutoJobPayload,
  type VaultMeta,
} from "@collector/shared";
import { MemorySqlAdapter } from "../../../../core/src/testing/memory-sql.js";
import {
  createExtractAutoAttemptStore,
  type ExtractAutoAttemptStore,
} from "../../extract/extract-auto-attempt-store.js";
import { createInstagramExtractorPlugin } from "../../extract/instagram/instagram-extractor-plugin.js";
import { OFFLINE_PUBLIC_LOOKUP } from "../../extract/offline-public-lookup.js";

import { createExtractPluginRegistry } from "../../extract-plugin-registry.js";
import { createItemsCrud } from "../../items-crud.js";
import {
  createJobPermanentFailureStore,
  type JobPermanentFailureStore,
} from "../../job-permanent-failure.js";
import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createItemExtractAutoHandler,
  enqueueItemExtractAuto,
} from "./item-extract-auto.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../extract/instagram/fixtures",
);

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const OK_SHORTCODE = "CxImage01ab";
const OK_URL = `https://www.instagram.com/p/${OK_SHORTCODE}/`;
const FAIL_SHORTCODE = "LoginWall1";
const FAIL_URL = `https://www.instagram.com/p/${FAIL_SHORTCODE}/`;

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function textResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init.headers,
    },
  });
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

/** Fixture-backed Instagram HTTP — no network. */
function createFixtureFetch(): typeof fetch {
  const singleEmbed = readFixture("single-image-embed.html");
  const loginWall = readFixture("login-wall-embed.html");

  return async (input) => {
    const url = String(input);

    if (url.includes(`/${OK_SHORTCODE}/embed/`)) {
      return textResponse(singleEmbed);
    }
    if (url.includes("cdn.instagram.fixture/single.jpg")) {
      return new Response(JPEG, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }

    // Login-wall layers for FAIL_SHORTCODE (same shape as fetch.test.ts).
    if (url.includes(`/${FAIL_SHORTCODE}/embed/`)) {
      return textResponse(loginWall);
    }
    if (url === "https://www.instagram.com/" || url === "https://www.instagram.com") {
      return textResponse("<html></html>", {
        headers: { "set-cookie": "csrftoken=fixture_csrf; Path=/" },
      });
    }
    if (url.includes("/web/get_ruling_for_content/")) {
      return jsonResponse(
        { status: "fail", title: "login_required" },
        { status: 200 },
      );
    }
    if (url.includes("/graphql/query/")) {
      return textResponse(loginWall, { status: 403 });
    }
    if (url.includes(`/p/${FAIL_SHORTCODE}`) && !url.includes("/embed/")) {
      return textResponse(loginWall);
    }
    if (url.includes("/api/v1/media/")) {
      return jsonResponse({ message: "login_required" }, { status: 403 });
    }
    if (url.includes("/api/graphql")) {
      return jsonResponse({ data: { xig_polaris_media: {} } });
    }

    throw new Error(`unexpected URL in item-extract-auto fixture fetch: ${url}`);
  };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("waitFor timed out");
}

type Harness = {
  ctx: VaultContext;
  vault: VaultMeta;
  vaultPath: string;
  dataDir: string;
  itemId: string;
  handler: ReturnType<typeof createItemExtractAutoHandler>;
  extractAutoAttempts: ExtractAutoAttemptStore;
  jobPermanentFailure: JobPermanentFailureStore;
  payload: ItemExtractAutoJobPayload;
};

describe("createItemExtractAutoHandler", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function openHarness(input: {
    body: string;
    metadata?: Record<string, unknown>;
  }): Promise<Harness> {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-item-extract-auto-"));
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
        url: null,
        content_type: "note",
        source_type: "manual",
        metadata: input.metadata ?? {},
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

    const attachMediaFiles = async (
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

    const plugin = createInstagramExtractorPlugin({
      getItemById: (id) => crud.getItemById(id),
      updateItem: (id, patch) => crud.updateItem(id, patch),
      attachMediaFiles,
      fetchImpl: createFixtureFetch(),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });
    const extract = createExtractPluginRegistry({
      getItemById: (id) => crud.getItemById(id),
      createCatalog: () => [plugin],
    });
    const jobPermanentFailure = createJobPermanentFailureStore();
    const extractAutoAttempts = createExtractAutoAttemptStore({ fs, dataDir });
    const handler = createItemExtractAutoHandler({
      discoverExtractCandidates: (id) => extract.discoverExtractCandidates(id),
      extractItemCandidate: (id, candidate) =>
        extract.extractItemCandidate(id, candidate),
      extractAutoAttempts,
      jobPermanentFailure,
    });

    return {
      ctx,
      vault,
      vaultPath,
      dataDir,
      itemId,
      handler,
      extractAutoAttempts,
      jobPermanentFailure,
      payload: {
        vaultId: vault.id,
        vaultPath,
        itemId,
        contentRevision: 1,
      },
    };
  }

  function job(id: string, payload: ItemExtractAutoJobPayload) {
    return {
      id,
      type: itemExtractAutoJobType.id,
      payload,
    } as never;
  }

  it("no-ops when the note has no extractable URLs", async () => {
    const h = await openHarness({ body: "plain note without links\n" });
    const before = await readItemRawMarkdown(fs, h.vaultPath, h.itemId);

    const result = await h.handler(job("job-empty", h.payload));

    expect(result).toEqual({ status: "ok" });
    const after = await readItemFile(fs, h.vaultPath, h.itemId, h.vault.id);
    expect(after.metadata.extract_auto).toBeUndefined();
    expect(await h.extractAutoAttempts.readItemAttempts(h.vault.id, h.itemId)).toEqual(
      {},
    );
    expect(await readItemRawMarkdown(fs, h.vaultPath, h.itemId)).toBe(before);
    expect(await listItemMediaWithPaths(h.ctx, h.vaultPath, h.itemId)).toEqual(
      [],
    );
  });

  it("extracts Instagram fixture into vault note + media and marks attempt in host store", async () => {
    const h = await openHarness({
      body: `Keep preamble\n\n${OK_URL}\n`,
    });

    const result = await h.handler(job("job-ok", h.payload));

    expect(result).toEqual({ status: "ok" });

    const item = await readItemFile(fs, h.vaultPath, h.itemId, h.vault.id);
    expect(item.title).toBe("Morning ride");
    expect(item.url).toBe(OK_URL);
    expect(item.content_type).toBe("note");
    expect(item.metadata.extract_auto).toBeUndefined();

    const raw = await readItemRawMarkdown(fs, h.vaultPath, h.itemId);
    expect(raw).toContain("Keep preamble");
    expect(raw).toContain("Morning ride");
    expect(raw).not.toMatch(/extract_auto/);
    // Frontmatter url stays Instagram; body must not still hold the capture link.
    const body = raw.replace(/^---[\s\S]*?---\n/, "");
    expect(body).not.toContain(OK_URL);
    expect(body).not.toContain("instagram.com");

    const auto = await h.extractAutoAttempts.readItemAttempts(
      h.vault.id,
      h.itemId,
    );
    expect(auto[OK_SHORTCODE]?.ok).toBe(true);
    expect(typeof auto[OK_SHORTCODE]?.attempted_at).toBe("string");

    const media = await listItemMediaWithPaths(h.ctx, h.vaultPath, h.itemId);
    expect(media).toHaveLength(1);
    expect(media[0]!.filename).toBe(`${OK_SHORTCODE}.jpg`);
    expect(await fs.exists(media[0]!.absolute_path)).toBe(true);
    expect(await fs.readBinary(media[0]!.absolute_path)).toEqual(JPEG);
  });

  it("on extract failure marks host store fail, notifies, leaves body and media untouched", async () => {
    const failures: unknown[] = [];
    const h = await openHarness({ body: `${FAIL_URL}\n` });
    h.jobPermanentFailure.subscribe((payload) => {
      failures.push(payload);
    });

    const result = await h.handler(job("job-fail", h.payload));

    expect(result).toEqual({ status: "ok" });

    const item = await readItemFile(fs, h.vaultPath, h.itemId, h.vault.id);
    expect(item.title).toBe("Capture");
    expect(item.metadata.extract_auto).toBeUndefined();
    const auto = await h.extractAutoAttempts.readItemAttempts(
      h.vault.id,
      h.itemId,
    );
    expect(auto[FAIL_SHORTCODE]?.ok).toBe(false);
    expect(auto[FAIL_SHORTCODE]?.error).toMatch(/login_wall/i);

    const raw = await readItemRawMarkdown(fs, h.vaultPath, h.itemId);
    expect(raw).toContain(FAIL_URL);
    expect(raw).not.toMatch(/extract_auto/);
    expect(await listItemMediaWithPaths(h.ctx, h.vaultPath, h.itemId)).toEqual(
      [],
    );

    expect(failures).toHaveLength(1);
    const notified = failures[0] as {
      type: string;
      attempts: number;
      summary: string;
      detail?: string;
    };
    expect(notified.type).toBe("itemExtractAuto");
    expect(notified.attempts).toBe(1);
    expect(notified.summary).toBe("Автоимпорт не удался");
    expect(notified.detail).toContain(FAIL_SHORTCODE);
    expect(notified.detail).toContain(h.itemId);
  });

  it("skips shortcodes already recorded in host store (no second import)", async () => {
    const h = await openHarness({
      body: `${OK_URL}\n`,
    });
    await h.extractAutoAttempts.recordAttempt(h.vault.id, h.itemId, OK_SHORTCODE, {
      attempted_at: "2026-01-01T00:00:00.000Z",
      ok: false,
      error: "prev",
    });

    await h.handler(job("job-skip", h.payload));

    const item = await readItemFile(fs, h.vaultPath, h.itemId, h.vault.id);
    expect(item.title).toBe("Capture");
    expect(item.metadata.extract_auto).toBeUndefined();
    const auto = await h.extractAutoAttempts.readItemAttempts(
      h.vault.id,
      h.itemId,
    );
    expect(auto[OK_SHORTCODE]).toEqual({
      attempted_at: "2026-01-01T00:00:00.000Z",
      ok: false,
      error: "prev",
    });
    expect(await listItemMediaWithPaths(h.ctx, h.vaultPath, h.itemId)).toEqual(
      [],
    );
    const raw = await readItemRawMarkdown(fs, h.vaultPath, h.itemId);
    expect(raw).toContain(OK_URL);
  });

  it("ignores leftover note frontmatter extract_auto and records only in host store", async () => {
    const h = await openHarness({
      body: `${OK_URL}\n`,
      metadata: {
        extract_auto: {
          [OK_SHORTCODE]: {
            attempted_at: "2026-01-01T00:00:00.000Z",
            ok: false,
            error: "stale",
          },
        },
      },
    });

    await h.handler(job("job-legacy-meta", h.payload));

    const item = await readItemFile(fs, h.vaultPath, h.itemId, h.vault.id);
    const auto = await h.extractAutoAttempts.readItemAttempts(
      h.vault.id,
      h.itemId,
    );
    expect(auto[OK_SHORTCODE]?.ok).toBe(true);
    expect(JSON.stringify(item.metadata.extract_auto ?? null)).not.toContain(
      '"ok":true',
    );
  });

  it("tries untried shortcodes independently against the vault", async () => {
    const failures: unknown[] = [];
    const h = await openHarness({
      body: `${OK_URL}\n${FAIL_URL}\n`,
    });
    h.jobPermanentFailure.subscribe((payload) => {
      failures.push(payload);
    });

    await h.handler(job("job-multi", h.payload));

    const item = await readItemFile(fs, h.vaultPath, h.itemId, h.vault.id);
    expect(item.metadata.extract_auto).toBeUndefined();
    const auto = await h.extractAutoAttempts.readItemAttempts(
      h.vault.id,
      h.itemId,
    );
    expect(auto[OK_SHORTCODE]?.ok).toBe(true);
    expect(auto[FAIL_SHORTCODE]?.ok).toBe(false);

    expect(item.title).toBe("Morning ride");
    const media = await listItemMediaWithPaths(h.ctx, h.vaultPath, h.itemId);
    expect(media).toHaveLength(1);
    expect(media[0]!.filename).toBe(`${OK_SHORTCODE}.jpg`);

    expect(failures).toHaveLength(1);
    expect((failures[0] as { detail?: string }).detail).toContain(FAIL_SHORTCODE);
  });

  it("coalesces repeated extract-auto jobs for the same content revision", async () => {
    const h = await openHarness({
      body: `Keep preamble\n\n${OK_URL}\n`,
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const registry = createJobRegistry([itemExtractAutoJobType]);
    registry.register(itemExtractAutoJobType, async (queued) => {
      await gate;
      return h.handler(queued);
    });
    const queue = await createJobQueue({
      dbPath: join(dirs[dirs.length - 1]!, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const first = await enqueueItemExtractAuto(queue, h.payload);
    await waitFor(async () => (await queue.stats()).running === 1);
    const second = await enqueueItemExtractAuto(queue, h.payload);

    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });

    release();
    await waitFor(async () => (await queue.stats()).succeeded === 1);

    const item = await readItemFile(fs, h.vaultPath, h.itemId, h.vault.id);
    expect(item.title).toBe("Morning ride");
    const media = await listItemMediaWithPaths(h.ctx, h.vaultPath, h.itemId);
    expect(media).toHaveLength(1);
  });
});
