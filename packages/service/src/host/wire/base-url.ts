/**
 * Published HTTP baseUrl under dataDir (mirror of host-token).
 *
 * Host writes the bound URL after listen; clients with --data-dir dial without
 * a separate --base-url. Flag/env still win when set.
 */

import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SERVICE_HOST_BASE_URL_FILENAME = "collector-service.base-url";
/** Same env name MCP/CLI already use for an explicit override. */
export const SERVICE_HOST_BASE_URL_ENV = "COLLECTOR_SERVICE_BASE_URL";

export function defaultServiceHostBaseUrlPath(dataDir: string): string {
  return join(dataDir, SERVICE_HOST_BASE_URL_FILENAME);
}

export async function writeServiceHostBaseUrlFile(
  path: string,
  baseUrl: string,
): Promise<void> {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error(`Host baseUrl must be non-empty when writing ${path}`);
  }
  await writeFile(path, `${trimmed}\n`, { encoding: "utf8", mode: 0o644 });
}

export async function readServiceHostBaseUrlFile(path: string): Promise<string> {
  const raw = await readFile(path, "utf8");
  const baseUrl = raw.trim();
  if (!baseUrl) {
    throw new Error(`Host baseUrl file is empty: ${path}`);
  }
  return baseUrl;
}

export async function removeServiceHostBaseUrlFile(path: string): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

export type ResolveServiceHostBaseUrlOptions = {
  baseUrl?: string;
  dataDir?: string;
  /** `process.env` override; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
};

/**
 * Resolve HTTP baseUrl for a dialer.
 * Order: explicit baseUrl → COLLECTOR_SERVICE_BASE_URL → dataDir file.
 */
export async function resolveServiceHostBaseUrl(
  options: ResolveServiceHostBaseUrlOptions = {},
): Promise<string> {
  const explicit = options.baseUrl?.trim();
  if (explicit) {
    return explicit;
  }
  const env = options.env ?? process.env;
  const fromEnv = env[SERVICE_HOST_BASE_URL_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  const dataDir = options.dataDir?.trim();
  if (dataDir) {
    const path = defaultServiceHostBaseUrlPath(dataDir);
    try {
      return await readServiceHostBaseUrlFile(path);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err && err.code === "ENOENT") {
        throw Object.assign(
          new Error(
            `Host baseUrl file missing (is the Collector service running?): ${path}`,
          ),
          { code: "ENOENT", errno: err.errno, path },
        );
      }
      throw error;
    }
  }
  throw new Error(
    "Host endpoint required: --base-url / COLLECTOR_SERVICE_BASE_URL or --data-dir (baseUrl file)",
  );
}
