/**
 * Download remote media bytes for extract attach (#318).
 * Same SSRF / timeout / size class as fetchRemoteBytes (#739), but allows
 * image/* and video/* (Instagram CDN). Does not weaken the display-asset path.
 */

import { normalizeRemoteHttpUrl } from "@collector/core";

/** Reels/carousels need more headroom than cover.webp localization. */
export const EXTRACT_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
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
      `fetchExtractMediaBytes: invalid URL ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `fetchExtractMediaBytes: only http(s) allowed, got ${parsed.protocol} (${url})`,
    );
  }
  assertHostnameAllowed(parsed.hostname);
  return parsed;
}

function assertHostnameAllowed(hostname: string): void {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost")) {
    throw new Error(`fetchExtractMediaBytes: blocked host ${hostname}`);
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") {
    throw new Error(`fetchExtractMediaBytes: blocked host ${hostname}`);
  }
  if (isBlockedIpv4(host)) {
    throw new Error(`fetchExtractMediaBytes: blocked address ${hostname}`);
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
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function assertMediaContentType(contentType: string | null, url: string): void {
  if (!contentType) {
    return;
  }
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime === "application/octet-stream" ||
    mime === "binary/octet-stream"
  ) {
    return;
  }
  throw new Error(
    `fetchExtractMediaBytes: unsupported Content-Type ${mime} from ${url}`,
  );
}

function looksLikeImageMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 3) {
    return false;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true;
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return true;
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return true;
  }
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

function looksLikeVideoMagic(bytes: Uint8Array): boolean {
  // ISO BMFF / MP4: size + "ftyp"
  if (
    bytes.byteLength >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return true;
  }
  // EBML / WebM
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return true;
  }
  return false;
}

function looksLikeMediaMagic(bytes: Uint8Array): boolean {
  return looksLikeImageMagic(bytes) || looksLikeVideoMagic(bytes);
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
        `fetchExtractMediaBytes: content-length ${size} exceeds limit ${maxBytes} (${url})`,
      );
    }
  }

  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(
        `fetchExtractMediaBytes: body ${buffer.byteLength} exceeds limit ${maxBytes} (${url})`,
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
        `fetchExtractMediaBytes: body exceeds limit ${maxBytes} (${url})`,
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

export async function fetchExtractMediaBytes(
  url: string,
  options?: {
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
    /** Extra request headers (e.g. Referer for Instagram CDN). */
    headers?: Record<string, string>;
  },
): Promise<Uint8Array> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? EXTRACT_MEDIA_MAX_BYTES;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const requestHeaders = options?.headers;

  let current = normalizeFetchUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const response = await fetchImpl(current.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        ...(requestHeaders === undefined ? {} : { headers: requestHeaders }),
      });

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location")
      ) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(
            `fetchExtractMediaBytes: redirect without Location from ${current.href}`,
          );
        }
        current = normalizeFetchUrl(new URL(location, current).href);
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `fetchExtractMediaBytes: ${current.href} returned ${response.status} ${response.statusText}`,
        );
      }

      assertMediaContentType(response.headers.get("content-type"), current.href);
      const buffer = await readBodyCapped(response, maxBytes, current.href);
      if (buffer.byteLength === 0) {
        throw new Error(
          `fetchExtractMediaBytes: empty body from ${current.href}`,
        );
      }
      if (!looksLikeMediaMagic(buffer)) {
        throw new Error(
          `fetchExtractMediaBytes: response is not a recognized image/video from ${current.href}`,
        );
      }
      return buffer;
    }

    throw new Error(
      `fetchExtractMediaBytes: too many redirects (max ${MAX_REDIRECTS}) for ${url}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("fetchExtractMediaBytes failed", { url, error: message });
    throw error instanceof Error
      ? error
      : new Error(`fetchExtractMediaBytes: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}
