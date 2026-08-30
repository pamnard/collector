/**
 * Host HTTP request error boundary (#933).
 */

import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { runServiceHostHttpRequest } from "./host-request.js";

describe("runServiceHostHttpRequest (#933)", () => {
  it("maps handler throw to HTTP 500 JSON without unhandledRejection", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const server = createServer((req, res) => {
      runServiceHostHttpRequest(req, res, async () => {
        throw new Error("host wrapper boom #933");
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to bind test server");
      }
      const res = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(res.status).toBe(500);
      const body = (await res.json()) as {
        ok: boolean;
        error?: { code?: string; message?: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("failed");
      expect(body.error?.message).toMatch(/host wrapper boom/);
      await new Promise((resolve) => setImmediate(resolve));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
