import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureExportItemPdfStore,
  storeExportItemPdf,
} from "../../export/export-item-pdf-store.js";
import {
  handleExportItemPdf,
  isExportItemPdfRequest,
} from "./export-item-pdf-handler.js";

const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe("export-item-pdf HTTP (#304)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches GET/HEAD /export/item-pdf only", () => {
    expect(isExportItemPdfRequest("GET", "/export/item-pdf")).toBe(true);
    expect(isExportItemPdfRequest("HEAD", "/export/item-pdf")).toBe(true);
    expect(isExportItemPdfRequest("POST", "/export/item-pdf")).toBe(false);
    expect(isExportItemPdfRequest("GET", "/media/file")).toBe(false);
  });

  it("streams stored PDF bytes with host token auth", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-export-http-"));
    dirs.push(dataDir);
    configureExportItemPdfStore(dataDir);
    await storeExportItemPdf("job-http-1", "Note.pdf", FAKE_PDF);

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void handleExportItemPdf(req, res, url, { expectedToken: "tok" });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }

    try {
      const unauthorized = await fetch(
        `http://127.0.0.1:${address.port}/export/item-pdf?jobId=job-http-1`,
      );
      expect(unauthorized.status).toBe(401);

      const ok = await fetch(
        `http://127.0.0.1:${address.port}/export/item-pdf?jobId=job-http-1&token=tok`,
      );
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toBe("application/pdf");
      const bytes = new Uint8Array(await ok.arrayBuffer());
      expect(bytes).toEqual(FAKE_PDF);

      const gone = await fetch(
        `http://127.0.0.1:${address.port}/export/item-pdf?jobId=job-http-1&token=tok`,
      );
      expect(gone.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
