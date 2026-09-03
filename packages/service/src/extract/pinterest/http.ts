/**
 * Minimal Pinterest HTTP helpers for multi-layer fetch (#34).
 */

import type { PinterestHttpFetch } from "./types.js";
import { canonicalPinUrl } from "./url.js";

export const PINTEREST_WEB_ORIGIN = "https://www.pinterest.com";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const DOCUMENT_GET_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

const JSON_GET_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  Referer: `${PINTEREST_WEB_ORIGIN}/`,
};

export type PinterestHttpTextResponse = {
  status: number;
  text: string;
  finalUrl: string;
};

export type PinterestHttpClient = {
  getText: (
    url: string,
    headers?: Record<string, string>,
  ) => Promise<PinterestHttpTextResponse>;
};

export function createPinterestHttpClient(input: {
  fetchImpl: PinterestHttpFetch;
}): PinterestHttpClient {
  const fetchImpl = input.fetchImpl;

  return {
    async getText(url, headers = DOCUMENT_GET_HEADERS) {
      const response = await fetchImpl(url, {
        method: "GET",
        headers,
        redirect: "follow",
      });
      const text = await response.text();
      return {
        status: response.status,
        text,
        finalUrl: response.url || url,
      };
    },
  };
}

export function pinPageUrl(pinId: string): string {
  return canonicalPinUrl(pinId);
}

export function pinResourceUrl(pinId: string): string {
  const data = JSON.stringify({
    options: {
      field_set_key: "unauth_react_main_pin",
      id: pinId,
    },
  });
  return `${PINTEREST_WEB_ORIGIN}/resource/PinResource/get/?data=${encodeURIComponent(data)}`;
}

export function jsonGetHeaders(): Record<string, string> {
  return { ...JSON_GET_HEADERS };
}

export { classifyHttpStatus } from "../classify-http-status.js";

export function looksLikeLoginWall(bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return (
    lower.includes("signup") &&
    (lower.includes("log in") || lower.includes("login")) &&
    !lower.includes("closeup_unified_description") &&
    !lower.includes('"images"')
  );
}
