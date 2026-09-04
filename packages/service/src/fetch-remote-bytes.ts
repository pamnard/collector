/**
 * Download remote bytes for display-asset localization and extract attach.
 * Fail hard — no silent empty body / keep-remote.
 * Hard size cap + SSRF gates (literal + DNS-resolved addresses, every redirect hop).
 * Markdown `![](…)` embeds may be image or video — both must land on disk.
 */

import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { normalizeRemoteHttpUrl } from "@collector/core";

/** Article/reel videos exceed the old 20 MiB image-only cap. */
export const REMOTE_DISPLAY_ASSET_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]);

/** Resolve hostname → address strings (IPv4 / IPv6). Injectable for SSRF tests. */
export type LookupHostAddresses = (
  hostname: string,
) => Promise<readonly string[]>;

export type FetchRemoteBytesOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  /** Extra request headers (e.g. Referer for CDN). */
  headers?: Record<string, string>;
  /** Error / log prefix (default `fetchRemoteBytes`). */
  label?: string;
  /** Override DNS resolution (defaults to `dns.lookup` all records). */
  lookupAddresses?: LookupHostAddresses;
};

async function defaultLookupAddresses(
  hostname: string,
): Promise<readonly string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function normalizeFetchUrl(
  url: string,
  label: string,
  lookup: LookupHostAddresses,
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(normalizeRemoteHttpUrl(url));
  } catch (error) {
    throw new Error(
      `${label}: invalid URL ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${label}: only http(s) allowed, got ${parsed.protocol} (${url})`,
    );
  }
  await assertHostnameAllowed(parsed.hostname, label, lookup);
  return parsed;
}

async function assertHostnameAllowed(
  hostname: string,
  label: string,
  lookup: LookupHostAddresses,
): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost")) {
    throw new Error(`${label}: blocked host ${hostname}`);
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    if (isBlockedIpv4(host)) {
      throw new Error(`${label}: blocked address ${hostname}`);
    }
    return;
  }
  if (ipVersion === 6) {
    if (isBlockedIpv6(host)) {
      throw new Error(`${label}: blocked address ${hostname}`);
    }
    return;
  }

  let addresses: readonly string[];
  try {
    addresses = await lookup(host);
  } catch (error) {
    throw new Error(
      `${label}: DNS lookup failed for ${hostname}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (addresses.length === 0) {
    throw new Error(
      `${label}: DNS lookup returned no addresses for ${hostname}`,
    );
  }
  for (const address of addresses) {
    if (isBlockedIpAddress(address)) {
      throw new Error(
        `${label}: blocked address ${address} for host ${hostname}`,
      );
    }
  }
}

function isBlockedIpAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  const version = isIP(host);
  if (version === 4) {
    return isBlockedIpv4(host);
  }
  if (version === 6) {
    return isBlockedIpv6(host);
  }
  return true;
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

function isBlockedIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "::" ||
    normalized === "0:0:0:0:0:0:0:0"
  ) {
    return true;
  }

  // IPv4-mapped / IPv4-compatible with dotted quad (before URL/normalization).
  const v4Mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(normalized);
  if (v4Mapped?.[1]) {
    return isBlockedIpv4(v4Mapped[1]);
  }
  const v4Compat = /^::(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(normalized);
  if (v4Compat?.[1]) {
    return isBlockedIpv4(v4Compat[1]);
  }

  const hextets = expandIpv6Hextets(normalized);
  if (hextets === null) {
    return true;
  }

  // ::ffff:AABB:CCDD → IPv4 A.B.C.D (URL often rewrites ::ffff:127.0.0.1 this way).
  if (
    hextets.slice(0, 5).every((h) => Number.parseInt(h, 16) === 0) &&
    Number.parseInt(hextets[5]!, 16) === 0xffff
  ) {
    const hi = Number.parseInt(hextets[6]!, 16);
    const lo = Number.parseInt(hextets[7]!, 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
      return true;
    }
    const embedded = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIpv4(embedded);
  }

  const first = Number.parseInt(hextets[0]!, 16);
  // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfe80) {
    return true;
  }
  // fc00::/7 unique local
  if ((first & 0xfe00) === 0xfc00) {
    return true;
  }
  // ff00::/8 multicast
  if ((first & 0xff00) === 0xff00) {
    return true;
  }
  return false;
}

/** Expand IPv6 into 8 hextet strings, or null if unparseable. */
function expandIpv6Hextets(host: string): string[] | null {
  if (host.includes(".")) {
    return null;
  }
  const sides = host.split("::");
  if (sides.length > 2) {
    return null;
  }
  const head = sides[0] === "" ? [] : sides[0]!.split(":");
  const tail =
    sides.length === 1 || sides[1] === "" ? [] : sides[1]!.split(":");
  if (head.some((h) => h.length === 0) || tail.some((t) => t.length === 0)) {
    return null;
  }
  const missing = 8 - head.length - tail.length;
  if (sides.length === 2) {
    if (missing < 0) {
      return null;
    }
    return [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  }
  if (head.length !== 8) {
    return null;
  }
  return head;
}

function assertDisplayAssetContentType(
  contentType: string | null,
  url: string,
  label: string,
): void {
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
  throw new Error(`${label}: unsupported Content-Type ${mime} from ${url}`);
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
  if (
    bytes.byteLength >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return true;
  }
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

function looksLikeDisplayAssetMagic(bytes: Uint8Array): boolean {
  return looksLikeImageMagic(bytes) || looksLikeVideoMagic(bytes);
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
  url: string,
  label: string,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new Error(
        `${label}: content-length ${size} exceeds limit ${maxBytes} (${url})`,
      );
    }
  }

  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(
        `${label}: body ${buffer.byteLength} exceeds limit ${maxBytes} (${url})`,
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
      throw new Error(`${label}: body exceeds limit ${maxBytes} (${url})`);
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
  options?: FetchRemoteBytesOptions,
): Promise<Uint8Array> {
  const label = options?.label ?? "fetchRemoteBytes";
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? REMOTE_DISPLAY_ASSET_MAX_BYTES;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const requestHeaders = options?.headers;
  const lookup = options?.lookupAddresses ?? defaultLookupAddresses;

  let current = await normalizeFetchUrl(url, label, lookup);
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
            `${label}: redirect without Location from ${current.href}`,
          );
        }
        current = await normalizeFetchUrl(
          new URL(location, current).href,
          label,
          lookup,
        );
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `${label}: ${current.href} returned ${response.status} ${response.statusText}`,
        );
      }

      assertDisplayAssetContentType(
        response.headers.get("content-type"),
        current.href,
        label,
      );
      const buffer = await readBodyCapped(
        response,
        maxBytes,
        current.href,
        label,
      );
      if (buffer.byteLength === 0) {
        throw new Error(`${label}: empty body from ${current.href}`);
      }
      if (!looksLikeDisplayAssetMagic(buffer)) {
        throw new Error(
          `${label}: response is not a recognized image/video from ${current.href}`,
        );
      }
      return buffer;
    }

    throw new Error(
      `${label}: too many redirects (max ${MAX_REDIRECTS}) for ${url}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${label} failed`, { url, error: message });
    throw error instanceof Error ? error : new Error(`${label}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}
