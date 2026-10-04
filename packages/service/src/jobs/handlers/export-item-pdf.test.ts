import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportItemPdfJobType } from "@collector/shared";
import {
  configureExportItemPdfStore,
  peekExportItemPdfResult,
} from "../../export/export-item-pdf-store.js";
import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createExportItemPdfHandler,
  enqueueExportItemPdf,
  takeExportItemPdfResult,
  toExportItemPdfResult,
} from "./export-item-pdf.js";

const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

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

describe("exportItemPdf job (#304)", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds HTML, calls htmlToPdf, and stores a temp PDF for HTTP download", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-export-pdf-data-"));
    dirs.push(dataDir);
    configureExportItemPdfStore(dataDir);

    const htmlToPdf = vi.fn(async () => FAKE_PDF);
    const buildItemPrintHtml = vi.fn(async () => ({
      html: '<html data-print-theme="light"><body>Fixture</body></html>',
      filename: "Fixture.pdf",
      model: {
        title: "Fixture",
        hero: null,
        bodyParts: [],
        referencedFilenames: [],
      },
    }));
    const assertPdfEngineReady = vi.fn(async () => {});
    const handler = createExportItemPdfHandler({
      buildItemPrintHtml,
      htmlToPdf,
      assertPdfEngineReady,
      assertActiveVault: async () => {},
    });

    const result = await handler({
      id: "job-pdf-1",
      type: "exportItemPdf",
      attempts: 0,
      payload: { vaultId: "v1", itemId: "Inbox/fixture.md" },
    });

    expect(result).toEqual({ status: "ok" });
    expect(assertPdfEngineReady).toHaveBeenCalledOnce();
    expect(buildItemPrintHtml).toHaveBeenCalledWith("Inbox/fixture.md");
    expect(htmlToPdf).toHaveBeenCalledOnce();
    const stored = peekExportItemPdfResult("job-pdf-1");
    expect(stored?.filename).toBe("Fixture.pdf");
    expect(stored?.absolutePath).toBeTruthy();
    expect(readFileSync(stored!.absolutePath)).toEqual(Buffer.from(FAKE_PDF));
    expect(toExportItemPdfResult("job-pdf-1")).toEqual({
      filename: "Fixture.pdf",
      downloadPath: "/export/item-pdf?jobId=job-pdf-1",
    });
    expect(JSON.stringify(toExportItemPdfResult("job-pdf-1"))).not.toContain(
      "pdfBase64",
    );
  });

  it("fails permanently when Playwright/Chromium is not ready", async () => {
    const handler = createExportItemPdfHandler({
      buildItemPrintHtml: async () => ({
        html: "<html></html>",
        filename: "X.pdf",
        model: {
          title: "X",
          hero: null,
          bodyParts: [],
          referencedFilenames: [],
        },
      }),
      htmlToPdf: async () => FAKE_PDF,
      assertPdfEngineReady: async () => {
        throw new Error("Playwright Chromium cannot launch for PDF export: missing");
      },
      assertActiveVault: async () => {},
    });

    const result = await handler({
      id: "job-pdf-engine",
      type: "exportItemPdf",
      attempts: 0,
      payload: { vaultId: "v1", itemId: "Inbox/fixture.md" },
    });

    expect(result).toEqual({
      status: "fail",
      retryable: false,
      error: "Playwright Chromium cannot launch for PDF export: missing",
    });
    expect(takeExportItemPdfResult("job-pdf-engine")).toBeNull();
  });

  it("fails permanently when print composition is not ready", async () => {
    const handler = createExportItemPdfHandler({
      buildItemPrintHtml: async () => {
        throw new Error("print image not ready: media/u/x.png");
      },
      htmlToPdf: async () => FAKE_PDF,
      assertPdfEngineReady: async () => {},
      assertActiveVault: async () => {},
    });

    const result = await handler({
      id: "job-pdf-fail",
      type: "exportItemPdf",
      attempts: 0,
      payload: { vaultId: "v1", itemId: "Inbox/fixture.md" },
    });

    expect(result).toEqual({
      status: "fail",
      retryable: false,
      error: "print image not ready: media/u/x.png",
    });
    expect(takeExportItemPdfResult("job-pdf-fail")).toBeNull();
  });

  it("dedupes active export for same vaultId+itemId", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-export-pdf-"));
    dirs.push(dir);
    configureExportItemPdfStore(dir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registry = createJobRegistry([exportItemPdfJobType]);
    registry.register(
      exportItemPdfJobType,
      createExportItemPdfHandler({
        buildItemPrintHtml: async () => {
          await gate;
          return {
            html: "<html></html>",
            filename: "A.pdf",
            model: {
              title: "A",
              hero: null,
              bodyParts: [],
              referencedFilenames: [],
            },
          };
        },
        htmlToPdf: async () => FAKE_PDF,
        assertPdfEngineReady: async () => {},
        assertActiveVault: async () => {},
      }),
    );
    const queue = await createJobQueue({
      dbPath: join(dir, "jobs.sqlite"),
      registry,
      concurrency: 1,
    });
    queues.push(queue);
    queue.start();

    const first = await enqueueExportItemPdf(queue, {
      vaultId: "v1",
      itemId: "Inbox/a.md",
    });
    const second = await enqueueExportItemPdf(queue, {
      vaultId: "v1",
      itemId: "Inbox/a.md",
    });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);

    release();
    await waitFor(async () => {
      const row = await queue.getJob(first.id);
      return row?.status === "succeeded";
    });
    expect(takeExportItemPdfResult(first.id)?.filename).toBe("A.pdf");
  });
});
