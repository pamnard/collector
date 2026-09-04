/**
 * Minimal Twitter/X HTTP helpers for extract fetch (#954).
 */

import type { TwitterHttpFetch } from "./types.js";

export const TWITTER_WEB_ORIGIN = "https://x.com";

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
  Referer: `${TWITTER_WEB_ORIGIN}/`,
};

export type TwitterHttpTextResponse = {
  status: number;
  text: string;
  finalUrl: string;
};

export type TwitterHttpClient = {
  getText: (
    url: string,
    headers?: Record<string, string>,
  ) => Promise<TwitterHttpTextResponse>;
};

export function createTwitterHttpClient(input: {
  fetchImpl: TwitterHttpFetch;
}): TwitterHttpClient {
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

export function jsonGetHeaders(): Record<string, string> {
  return { ...JSON_GET_HEADERS };
}

export { classifyHttpStatus } from "../classify-http-status.js";

export function looksLikeLoginWall(bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return (
    (lower.includes("log in") || lower.includes("sign up") || lower.includes("login")) &&
    (lower.includes("sign up") || lower.includes("create your account")) &&
    !lower.includes('"text"') &&
    !lower.includes("collector-twitter-article")
  );
}
