/**
 * Service IPC private-bus credential (#336).
 *
 * IPC is a private host bus for first-party clients. External programs contact
 * Collector only via explicitly published surfaces (today: MCP). The host writes
 * a per-start token under dataDir; clients must `auth` before any other traffic.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isWindowsNamedPipePath } from "./paths.js";

export const SERVICE_IPC_TOKEN_FILENAME = "collector-service.ipc-token";
export const SERVICE_IPC_AUTH_METHOD = "auth";
export const SERVICE_IPC_TOKEN_ENV = "COLLECTOR_IPC_TOKEN";

const TOKEN_BYTES = 32;

export function defaultServiceIpcTokenPath(dataDir: string): string {
  return join(dataDir, SERVICE_IPC_TOKEN_FILENAME);
}

/** Sibling token file for a Unix socket named `collector-service.sock`. */
export function siblingServiceIpcTokenPath(ipcPath: string): string | null {
  if (isWindowsNamedPipePath(ipcPath)) {
    return null;
  }
  if (basename(ipcPath) !== "collector-service.sock") {
    return null;
  }
  return join(dirname(ipcPath), SERVICE_IPC_TOKEN_FILENAME);
}

export function generateServiceIpcToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export async function writeServiceIpcTokenFile(
  tokenPath: string,
  token: string,
): Promise<void> {
  await writeFile(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function readServiceIpcTokenFile(
  tokenPath: string,
): Promise<string> {
  const raw = await readFile(tokenPath, "utf8");
  const token = raw.trim();
  if (!token) {
    throw new Error(`IPC token file is empty: ${tokenPath}`);
  }
  return token;
}

export async function removeServiceIpcTokenFile(
  tokenPath: string,
): Promise<void> {
  await unlink(tokenPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

export function tokensEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function extractAuthToken(params: unknown): string | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const token = (params as { token?: unknown }).token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export type ResolveServiceIpcTokenOptions = {
  token?: string;
  tokenFile?: string;
  dataDir?: string;
  /** `process.env` override; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
};

/**
 * Resolve the IPC handshake token for a dialer.
 * Order: explicit token → tokenFile → COLLECTOR_IPC_TOKEN → dataDir file →
 * sibling of collector-service.sock.
 */
export async function resolveServiceIpcToken(
  ipcPath: string,
  options: ResolveServiceIpcTokenOptions = {},
): Promise<string> {
  if (options.token !== undefined && options.token.length > 0) {
    return options.token;
  }
  if (options.tokenFile !== undefined) {
    return readServiceIpcTokenFile(options.tokenFile);
  }
  const env = options.env ?? process.env;
  const fromEnv = env[SERVICE_IPC_TOKEN_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  if (options.dataDir !== undefined) {
    try {
      return await readServiceIpcTokenFile(
        defaultServiceIpcTokenPath(options.dataDir),
      );
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err && err.code === "ENOENT") {
        throw Object.assign(
          new Error(
            `IPC token file missing (is the Collector service running?): ${defaultServiceIpcTokenPath(options.dataDir)}`,
          ),
          {
            code: "ENOENT",
            errno: err.errno,
            path: defaultServiceIpcTokenPath(options.dataDir),
          },
        );
      }
      throw error;
    }
  }
  const sibling = siblingServiceIpcTokenPath(ipcPath);
  if (sibling) {
    try {
      return await readServiceIpcTokenFile(sibling);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err && err.code === "ENOENT") {
        throw Object.assign(
          new Error(
            `IPC token file missing (is the Collector service running?): ${sibling}`,
          ),
          { code: "ENOENT", errno: err.errno, path: sibling },
        );
      }
      throw error;
    }
  }
  if (isWindowsNamedPipePath(ipcPath)) {
    throw new Error(
      "IPC auth token required for named pipe: pass dataDir, token, tokenFile, or COLLECTOR_IPC_TOKEN",
    );
  }
  throw new Error(
    "IPC auth token required: pass dataDir, token, tokenFile, or COLLECTOR_IPC_TOKEN",
  );
}
