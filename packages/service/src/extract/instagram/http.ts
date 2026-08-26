/**
 * Minimal cookie jar + Instagram HTTP helpers for multi-layer fetch.
 */

import { asRecord } from "./json-unknown.js";
import type { InstagramHttpFetch } from "./types.js";

export const IG_WEB_ORIGIN = "https://www.instagram.com";
export const IG_API_BASE = "https://i.instagram.com/api/v1";

export const IG_APP_ID = "936619743392459";
export const IG_ASBD_ID = "198387";

export const LOGGED_OUT_QUERY_NAME =
  "PolarisLoggedOutDesktopWWWPostRootContentQuery";
export const LOGGED_OUT_QUERY_DOC_ID = "27130156389949648";
export const LEGACY_SHORTCODE_DOC_ID = "8845758582119845";

const BASE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: IG_WEB_ORIGIN,
  Referer: `${IG_WEB_ORIGIN}/`,
};

const API_HEADERS: Record<string, string> = {
  "X-IG-App-ID": IG_APP_ID,
  "X-ASBD-ID": IG_ASBD_ID,
  "X-IG-WWW-Claim": "0",
};

function parseCookiePair(part: string): { name: string; value: string } | null {
  const eq = part.indexOf("=");
  if (eq <= 0) {
    return null;
  }
  const name = part.slice(0, eq).trim();
  const value = part.slice(eq + 1).trim();
  if (name.length === 0) {
    return null;
  }
  return { name, value };
}

export class InstagramCookieJar {
  private readonly store = new Map<string, string>();

  constructor(initial?: string | Readonly<Record<string, string>>) {
    if (!initial) {
      return;
    }
    if (typeof initial === "string") {
      for (const part of initial.split(";")) {
        const pair = parseCookiePair(part);
        if (pair) {
          this.store.set(pair.name, pair.value);
        }
      }
      return;
    }
    for (const [name, value] of Object.entries(initial)) {
      this.store.set(name, value);
    }
  }

  get(name: string): string | undefined {
    return this.store.get(name);
  }

  headerValue(): string | undefined {
    if (this.store.size === 0) {
      return undefined;
    }
    return [...this.store.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  absorbSetCookie(header: null | string | string[]): void {
    if (header === null) {
      return;
    }
    const parts = Array.isArray(header) ? header : [header];
    for (const part of parts) {
      const pair = parseCookiePair(part.split(";", 1)[0] ?? "");
      if (pair) {
        this.store.set(pair.name, pair.value);
      }
    }
  }
}

export type InstagramHttpResponse = {
  status: number;
  text: string;
};

export type InstagramHttpClient = {
  getText(
    url: string,
    headers?: Record<string, string>,
  ): Promise<InstagramHttpResponse>;
  postForm(
    url: string,
    form: Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<InstagramHttpResponse>;
  cookies: InstagramCookieJar;
};

export function createInstagramHttpClient(deps: {
  fetchImpl: InstagramHttpFetch;
  cookies?: string | Readonly<Record<string, string>>;
}): InstagramHttpClient {
  const cookies = new InstagramCookieJar(deps.cookies);
  const fetchImpl = deps.fetchImpl;

  async function request(
    url: string,
    init: RequestInit,
    extraHeaders?: Record<string, string>,
  ): Promise<InstagramHttpResponse> {
    const headers = new Headers({ ...BASE_HEADERS, ...extraHeaders });
    const cookieHeader = cookies.headerValue();
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }
    for (const [key, value] of Object.entries(init.headers ?? {})) {
      headers.set(key, value);
    }

    const response = await fetchImpl(url, { ...init, headers });
    const setCookie =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : response.headers.get("set-cookie");
    cookies.absorbSetCookie(setCookie);

    const text = await response.text();
    return { status: response.status, text };
  }

  return {
    cookies,
    getText(url, headers) {
      return request(url, { method: "GET" }, headers);
    },
    postForm(url, form, headers) {
      const body = new URLSearchParams(form).toString();
      return request(
        url,
        {
          method: "POST",
          body,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
        headers,
      );
    },
  };
}

export function apiHeaders(
  cookies: InstagramCookieJar,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...API_HEADERS, ...extra };
  const csrf = cookies.get("csrftoken");
  if (csrf) {
    headers["X-CSRFToken"] = csrf;
  }
  return headers;
}

export function classifyHttpStatus(
  status: number,
): "ok" | "not_found" | "rate_limited" | "private_or_unavailable" | "other" {
  if (status >= 200 && status < 300) {
    return "ok";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 401 || status === 403) {
    return "private_or_unavailable";
  }
  return "other";
}

export function extractLsdToken(webpage: string): string | null {
  const patterns = [
    /\["LSD",\[\],\{"token":"([^"]+)"/,
    /"LSD",\[\],\{"token":"([^"]+)"/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(webpage);
    if (match?.[1]) {
      return match[1];
    }
  }

  const eqmc = /<script\b[^>]*\bid=["']__eqmc["'][^>]*>([\s\S]*?)<\/script>/i.exec(
    webpage,
  );
  if (!eqmc?.[1]) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(eqmc[1]);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  const token = asRecord(data)?.l;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * Decode a JSON string literal starting at `start` (Python raw_decode equivalent
 * for the double-encoded embed `contextJSON` value).
 */
function rawDecodeJsonStringLiteral(
  source: string,
  start: number,
): string | null {
  let i = start;
  while (i < source.length && /\s/.test(source[i]!)) {
    i += 1;
  }
  if (source[i] !== '"') {
    return null;
  }
  i += 1;
  let out = "";
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '"') {
      return out;
    }
    if (ch === "\\") {
      i += 1;
      if (i >= source.length) {
        return null;
      }
      const esc = source[i]!;
      switch (esc) {
        case '"':
        case "\\":
        case "/":
          out += esc;
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const hex = source.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            return null;
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
          break;
        }
        default:
          return null;
      }
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return null;
}

export function extractContextJsonMedia(webpage: string): unknown | null {
  const key = '"contextJSON":';
  const index = webpage.indexOf(key);
  if (index < 0) {
    return null;
  }
  const inner = rawDecodeJsonStringLiteral(webpage, index + key.length);
  if (inner === null) {
    return null;
  }
  let context: unknown;
  try {
    context = JSON.parse(inner);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  const gql = asRecord(asRecord(context)?.gql_data);
  return gql?.shortcode_media ?? null;
}

export function looksLikeLoginWall(webpage: string): boolean {
  return (
    /login_required/i.test(webpage) ||
    /"require_login"\s*:\s*true/i.test(webpage) ||
    /www\.instagram\.com\/accounts\/login/i.test(webpage)
  );
}
