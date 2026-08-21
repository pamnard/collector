/**
 * Download remote bytes for display-asset localization (#739).
 * Fail hard — no silent empty body / keep-remote.
 * Hard size cap + basic SSRF / content-type gates (same class as Telegram downloads).
 */

import { normalizeRemoteHttpUrl } from "@collector/core";

export const REMOTE_DISPLAY_ASSET_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]);

function normalizeFetchUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(normalizeRemoteHttpUrl(url));
  } catch (error) {
    throw new Error(
      `fetchRemoteBytes: invalid URL ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `fetchRemoteBytes: only http(s) allowed, got ${parsed.protocol} (${url})`,
    );
  }
  assertHostnameAllowed(parsed.hostname);
  return parsed;
}

function assertHostnameAllowed(hostname: string): void {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost")) {
    throw new Error(`fetchRemoteBytes: blocked host ${hostname}`);
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") {
    throw new Error(`fetchRemoteBytes: blocked host ${hostname}`);
  }
  if (isBlockedIpv4(host)) {
    throw new Error(`fetchRemoteBytes: blocked address ${hostname}`);
  }
}

function isBlockedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = nums as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function assertImageContentType(contentType: string | null, url: string): void {
  if (!contentType) {
    return;
  }
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    mime.startsWith("image/") ||
    mime === "application/octet-stream" ||
    mime === "binary/octet-stream"
  ) {
    return;
  }
  throw new Error(
    `fetchRemoteBytes: non-image Content-Type ${mime} from ${url}`,
  );
}

function looksLikeImageMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 3) {
    return false;
  }
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true;
  }
  // PNG
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return true;
  }
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return true;
  }
  // WEBP (RIFF....WEBP)
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return true;
  }
  return false;
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
  url: string,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new Error(
        `fetchRemoteBytes: content-length ${size} exceeds limit ${maxBytes} (${url})`,
      );
    }
  }

  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(
        `fetchRemoteBytes: body ${buffer.byteLength} exceeds limit ${maxBytes} (${url})`,
      );
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(
        `fetchRemoteBytes: body exceeds limit ${maxBytes} (${url})`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function fetchRemoteBytes(
  url: string,
  options?: {
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<Uint8Array> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? REMOTE_DISPLAY_ASSET_MAX_BYTES;
  const fetchImpl = options?.fetchImpl ?? fetch;

  let current = normalizeFetchUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const response = await fetchImpl(current.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location")
      ) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(
            `fetchRemoteBytes: redirect without Location from ${current.href}`,
          );
        }
        current = normalizeFetchUrl(new URL(location, current).href);
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `fetchRemoteBytes: ${current.href} returned ${response.status} ${response.statusText}`,
        );
      }

      assertImageContentType(response.headers.get("content-type"), current.href);
      const buffer = await readBodyCapped(response, maxBytes, current.href);
      if (buffer.byteLength === 0) {
        throw new Error(`fetchRemoteBytes: empty body from ${current.href}`);
      }
      if (!looksLikeImageMagic(buffer)) {
        throw new Error(
          `fetchRemoteBytes: response is not a recognized image from ${current.href}`,
        );
      }
      return buffer;
    }

    throw new Error(
      `fetchRemoteBytes: too many redirects (max ${MAX_REDIRECTS}) for ${url}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("fetchRemoteBytes failed", { url, error: message });
    throw error instanceof Error
      ? error
      : new Error(`fetchRemoteBytes: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}
