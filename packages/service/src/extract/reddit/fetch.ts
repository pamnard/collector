/**
 * Reddit post fetch via public `.json` (#955).
 * HTTP is injected; CI uses committed fixtures only.
 * Live fetch requires browser cookies (Cookie header) — no anonymous soft-fail.
 */

import {
  classifyHttpStatus,
  createRedditHttpClient,
  jsonGetHeaders,
  looksLikeLoginWall,
  postJsonUrl,
  type RedditHttpClient,
} from "./http.js";
import { loadRedditCookieHeader } from "./load-cookie-header.js";
import { parseRedditPostJson } from "./parse-post.js";
import { parseRedditTarget } from "./reddit-url-discover.js";
import type {
  FetchRedditPostOptions,
  RedditFetchErrorCode,
  RedditFetchResult,
} from "./types.js";
import {
  canonicalPostUrl,
  parseRedditFetchTarget,
} from "./url.js";

type RedirectResult =
  | { ok: true; sourceUrl: string }
  | { ok: false; code: RedditFetchErrorCode; message: string };

function fail(
  code: RedditFetchErrorCode,
  message: string,
): { ok: false; code: RedditFetchErrorCode; message: string } {
  return { ok: false, code, message };
}

function blockedOrUnresolved(
  bodyText: string,
  statusKind: string,
  label: string,
): RedirectResult {
  if (statusKind === "private_or_unavailable") {
    return fail(
      looksLikeLoginWall(bodyText) ? "login_wall" : "private_or_unavailable",
      `${label} was blocked or unavailable`,
    );
  }
  return fail(
    looksLikeLoginWall(bodyText) ? "login_wall" : "invalid_url",
    `${label} could not be resolved`,
  );
}

async function resolveRedirectToPost(
  client: RedditHttpClient,
  requestUrl: string,
  failLabel: string,
): Promise<RedirectResult> {
  const response = await client.getText(requestUrl);
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return fail(
      "rate_limited",
      `Reddit rate limited the ${failLabel} redirect`,
    );
  }
  if (statusKind === "not_found") {
    return fail("not_found", `${failLabel} returned 404`);
  }
  if (statusKind !== "ok" && statusKind !== "other") {
    return blockedOrUnresolved(response.text, statusKind, failLabel);
  }

  const fromFinal = parseRedditTarget(response.finalUrl);
  if (fromFinal?.kind === "post") {
    return {
      ok: true,
      sourceUrl: canonicalPostUrl(fromFinal.submissionId, fromFinal.subreddit),
    };
  }

  const hrefMatch =
    /https?:\/\/(?:www\.|old\.|np\.|new\.)?reddit\.com\/[^\s"'<>]+/i.exec(
      response.text,
    );
  if (hrefMatch?.[0]) {
    const nested = parseRedditTarget(hrefMatch[0]);
    if (nested?.kind === "post") {
      return {
        ok: true,
        sourceUrl: canonicalPostUrl(nested.submissionId, nested.subreddit),
      };
    }
  }

  return fail(
    looksLikeLoginWall(response.text) ? "login_wall" : "invalid_url",
    `${failLabel} did not redirect to a post`,
  );
}

async function resolveRedditIt(
  client: RedditHttpClient,
  code: string,
): Promise<RedirectResult> {
  const resolved = await resolveRedirectToPost(
    client,
    `https://redd.it/${code}`,
    "redd.it short link",
  );
  if (resolved.ok) {
    return resolved;
  }
  // redd.it path segment is often the submission id; use it when redirect
  // did not yield a post URL (but not on hard 404 / rate limit).
  if (
    /^[A-Za-z0-9]+$/.test(code) &&
    resolved.code !== "rate_limited" &&
    resolved.code !== "not_found"
  ) {
    return { ok: true, sourceUrl: canonicalPostUrl(code) };
  }
  return resolved;
}

async function extractFromJson(
  client: RedditHttpClient,
  sourceUrl: string,
): Promise<RedditFetchResult> {
  const response = await client.getText(postJsonUrl(sourceUrl), jsonGetHeaders());
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return fail("rate_limited", "Reddit rate limited the post.json request");
  }
  if (statusKind === "not_found") {
    return fail("not_found", "Reddit returned 404 for post.json");
  }
  if (statusKind !== "ok") {
    if (statusKind === "private_or_unavailable") {
      return fail(
        looksLikeLoginWall(response.text)
          ? "login_wall"
          : "private_or_unavailable",
        "Reddit post.json was blocked or unavailable",
      );
    }
    return fail(
      looksLikeLoginWall(response.text) ? "login_wall" : "not_found",
      "Reddit post.json returned an unexpected status",
    );
  }

  const parsed = parseRedditPostJson(response.text, sourceUrl);
  if (!parsed.ok) {
    return fail(parsed.code, parsed.message);
  }
  return { ok: true, value: parsed.value };
}

async function resolveCookieHeader(
  options: FetchRedditPostOptions,
): Promise<
  | { ok: true; cookieHeader: string }
  | { ok: false; code: "cookies_unavailable"; message: string }
> {
  if (options.cookieHeader !== undefined) {
    const trimmed = options.cookieHeader.trim();
    if (trimmed.length === 0) {
      return {
        ok: false,
        code: "cookies_unavailable",
        message: "Reddit extract received an empty cookieHeader override",
      };
    }
    return { ok: true, cookieHeader: trimmed };
  }

  if (options.loadCookieHeaderImpl) {
    const loaded = await options.loadCookieHeaderImpl();
    if (!loaded.ok) {
      return {
        ok: false,
        code: "cookies_unavailable",
        message: loaded.message,
      };
    }
    return { ok: true, cookieHeader: loaded.cookieHeader };
  }

  const loaded = await loadRedditCookieHeader({
    cookiesBrowser: options.cookiesBrowser,
  });
  if (!loaded.ok) {
    return {
      ok: false,
      code: "cookies_unavailable",
      message: loaded.message,
    };
  }
  return { ok: true, cookieHeader: loaded.cookieHeader };
}

/**
 * Fetch a Reddit post (title / selftext / CDN media) with browser cookies.
 */
export async function fetchRedditPost(
  urlOrId: string,
  options: FetchRedditPostOptions = {},
): Promise<RedditFetchResult> {
  const target = parseRedditFetchTarget(urlOrId);
  if (!target) {
    return fail("invalid_url", "Not a supported Reddit post URL");
  }

  const cookies = await resolveCookieHeader(options);
  if (!cookies.ok) {
    return cookies;
  }

  const client = createRedditHttpClient({
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    cookieHeader: cookies.cookieHeader,
  });

  let sourceUrl = target.sourceUrl;
  if (target.kind === "reddit_it") {
    const resolved = await resolveRedditIt(client, target.code);
    if (!resolved.ok) {
      return resolved;
    }
    sourceUrl = resolved.sourceUrl;
  } else if (target.kind === "share") {
    const resolved = await resolveRedirectToPost(
      client,
      target.sourceUrl,
      "Reddit share link",
    );
    if (!resolved.ok) {
      return resolved;
    }
    sourceUrl = resolved.sourceUrl;
  }

  return extractFromJson(client, sourceUrl);
}
