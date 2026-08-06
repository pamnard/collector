import { createConnection } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectHostWire } from "./client.js";
import { encodeHostWireFrame, SERVICE_HOST_PROTOCOL_VERSION } from "./framing.js";
import { startHostWireServer } from "./server.js";

const TEST_TOKEN = "unit-test-host-token";

function tempDataDir(dirs: string[]): string {
  const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-"));
  dirs.push(dataDir);
  return dataDir;
}

async function startTestServer(
  dataDir: string,
  extras: {
    request?: (
      method: string,
      params?: unknown,
    ) => Promise<unknown | undefined>;
  } = {},
) {
  return startHostWireServer({
    dataDir,
    token: TEST_TOKEN,
    handler: {
      ping: () => ({ ok: true, pong: true }),
      health: () => ({
        ok: true,
        status: "healthy",
        open: true,
        healthy: true,
      }),
      ...extras,
    },
  });
}

describe("service IPC server/client", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dials health/ping over local IPC after auth", async () => {
    const dataDir = tempDataDir(dirs);
    const server = await startTestServer(dataDir);

    try {
      const client = await connectHostWire(server.path, {
        token: TEST_TOKEN,
      });
      try {
        expect(await client.ping()).toEqual({ ok: true, pong: true });
        expect(await client.health()).toMatchObject({
          ok: true,
          healthy: true,
          status: "healthy",
        });
      } finally {
        await client.close();
      }
    } finally {
      await server.close();
    }
  });

  it("rejects unauthenticated dial methods with auth_required", async () => {
    const dataDir = tempDataDir(dirs);
    const server = await startTestServer(dataDir);

    try {
      const result = await new Promise<{
        type: string;
        error?: { layer?: string; code?: string };
      }>((resolve, reject) => {
        const socket = createConnection({ path: server.path }, () => {
          socket.write(
            encodeHostWireFrame({
              v: SERVICE_HOST_PROTOCOL_VERSION,
              id: "1",
              type: "req",
              method: "ping",
            }),
          );
        });
        let buf = Buffer.alloc(0);
        socket.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          if (buf.length < 4) return;
          const len = buf.readUInt32BE(0);
          if (buf.length < 4 + len) return;
          resolve(JSON.parse(buf.subarray(4, 4 + len).toString("utf8")));
        });
        socket.on("error", reject);
      });

      expect(result).toMatchObject({
        type: "err",
        error: { layer: "auth", code: "auth_required" },
      });
    } finally {
      await server.close();
    }
  });

  it("rejects wrong auth token with auth_failed", async () => {
    const dataDir = tempDataDir(dirs);
    const server = await startTestServer(dataDir);

    try {
      await expect(
        connectHostWire(server.path, { token: "wrong-token" }),
      ).rejects.toMatchObject({
        layer: "auth",
        code: "auth_failed",
      });
    } finally {
      await server.close();
    }
  });

  it("does not broadcast events to unauthenticated sockets", async () => {
    const dataDir = tempDataDir(dirs);
    const server = await startTestServer(dataDir);

    try {
      const gotEvent = await new Promise<boolean>((resolve) => {
        const socket = createConnection({ path: server.path }, () => {
          server.broadcastEvent("vaultIndexSyncStatus", { phase: "idle" });
          setTimeout(() => resolve(false), 100);
        });
        socket.on("data", () => {
          resolve(true);
        });
        socket.on("error", () => resolve(false));
      });
      expect(gotEvent).toBe(false);

      const client = await connectHostWire(server.path, {
        token: TEST_TOKEN,
      });
      try {
        const payload = await new Promise<unknown>((resolve) => {
          client.onEvent("vaultIndexSyncStatus", resolve);
          server.broadcastEvent("vaultIndexSyncStatus", { phase: "scanning" });
        });
        expect(payload).toEqual({ phase: "scanning" });
      } finally {
        await client.close();
      }
    } finally {
      await server.close();
    }
  });

  it("rejects protocol mismatch with transport error after auth", async () => {
    const dataDir = tempDataDir(dirs);
    const server = await startTestServer(dataDir);

    try {
      const result = await new Promise<{
        type: string;
        error?: { code?: string };
      }>((resolve, reject) => {
        const socket = createConnection({ path: server.path }, () => {
          const authBody = Buffer.from(
            JSON.stringify({
              v: SERVICE_HOST_PROTOCOL_VERSION,
              id: "a",
              type: "req",
              method: "auth",
              params: { token: TEST_TOKEN },
            }),
            "utf8",
          );
          const authHeader = Buffer.allocUnsafe(4);
          authHeader.writeUInt32BE(authBody.length, 0);
          socket.write(Buffer.concat([authHeader, authBody]));

          const body = Buffer.from(
            JSON.stringify({
              v: SERVICE_HOST_PROTOCOL_VERSION + 99,
              id: "x",
              type: "req",
              method: "ping",
            }),
            "utf8",
          );
          const header = Buffer.allocUnsafe(4);
          header.writeUInt32BE(body.length, 0);
          socket.write(Buffer.concat([header, body]));
        });
        let buf = Buffer.alloc(0);
        let seen = 0;
        socket.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          while (buf.length >= 4) {
            const len = buf.readUInt32BE(0);
            if (buf.length < 4 + len) return;
            const message = JSON.parse(
              buf.subarray(4, 4 + len).toString("utf8"),
            );
            buf = buf.subarray(4 + len);
            seen += 1;
            if (seen === 2) {
              resolve(message);
              socket.end();
              return;
            }
          }
        });
        socket.on("error", reject);
      });

      expect(result.type).toBe("err");
      expect(result.error?.code).toBe("protocol_mismatch");
    } finally {
      await server.close();
    }
  });
});
