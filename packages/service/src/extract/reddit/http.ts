/**
 * Minimal Reddit HTTP helpers for extract fetch (#955).
 */

import { parseRemoteHttpUrl } from "../collect-http-urls.js";
import type { RedditHttpFetch } from "./types.js";

export const REDDIT_WEB_ORIGIN = "https://www.reddit.com";

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
  Referer: `${REDDIT_WEB_ORIGIN}/`,
};

const MAX_REDIRECTS = 8;

export type RedditHttpTextResponse = {
  status: number;
  text: string;
  finalUrl: string;
};

export type RedditHttpClient = {
  getText: (
    url: string,
    headers?: Record<string, string>,
  ) => Promise<RedditHttpTextResponse>;
};

/** Hosts that may receive the Reddit session Cookie header. */
export function isRedditSessionHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return (
    host === "reddit.com" ||
    host === "old.reddit.com" ||
    host === "new.reddit.com" ||
    host === "np.reddit.com" ||
    host === "redd.it" ||
    host.endsWith(".reddit.com")
  );
}

function resolveRedirectUrl(currentUrl: string, location: string): string {
  return new URL(location, currentUrl).toString();
}

export function createRedditHttpClient(input: {
  fetchImpl: RedditHttpFetch;
  /** Session Cookie header from browser dump — required for live Reddit. */
  cookieHeader: string;
}): RedditHttpClient {
  const fetchImpl = input.fetchImpl;
  const cookieHeader = input.cookieHeader.trim();
  if (cookieHeader.length === 0) {
    throw new Error("Reddit HTTP client requires a non-empty cookieHeader");
  }

  return {
    async getText(url, headers = DOCUMENT_GET_HEADERS) {
      let currentUrl = url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const parsed = parseRemoteHttpUrl(currentUrl);
        if (!parsed || !isRedditSessionHost(parsed.hostname)) {
          throw new Error(
            `Reddit HTTP refused non-Reddit hop (cookie pin): ${currentUrl}`,
          );
        }

        const response = await fetchImpl(currentUrl, {
          method: "GET",
          headers: { ...headers, Cookie: cookieHeader },
          redirect: "manual",
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) {
            const text = await response.text();
            return {
              status: response.status,
              text,
              finalUrl: currentUrl,
            };
          }
          currentUrl = resolveRedirectUrl(currentUrl, location);
          continue;
        }

        const text = await response.text();
        return {
          status: response.status,
          text,
          finalUrl: response.url || currentUrl,
        };
      }
      throw new Error(
        `Reddit HTTP exceeded ${MAX_REDIRECTS} redirects starting at ${url}`,
      );
    },
  };
}

export function jsonGetHeaders(): Record<string, string> {
  return { ...JSON_GET_HEADERS };
}

export function postJsonUrl(sourceUrl: string): string {
  const trimmed = sourceUrl.replace(/\/+$/, "");
  if (trimmed.endsWith(".json")) {
    return trimmed;
  }
  return `${trimmed}.json`;
}

export { classifyHttpStatus } from "../classify-http-status.js";

export function looksLikeLoginWall(bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return (
    (lower.includes("log in") || lower.includes("login")) &&
    (lower.includes("sign up") || lower.includes("create account")) &&
    !lower.includes('"selftext"') &&
    !lower.includes('"permalink"')
  );
}
