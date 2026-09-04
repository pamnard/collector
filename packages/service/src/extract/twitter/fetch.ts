/**
 * Multi-layer Twitter/X content fetch (#954).
 * HTTP is injected; CI uses committed fixtures only.
 */

import { parseJsonObject } from "../json-unknown.js";
import {
  classifyHttpStatus,
  createTwitterHttpClient,
  jsonGetHeaders,
  looksLikeLoginWall,
  type TwitterHttpClient,
} from "./http.js";
import { parseArticleFromHtml } from "./parse-article.js";
import { parseStatusFromSyndication } from "./parse-status.js";
import { syndicationTweetResultUrl } from "./syndication-token.js";
import type {
  FetchTwitterContentOptions,
  TwitterFetchErrorCode,
  TwitterFetchResult,
  TwitterFetchSuccess,
} from "./types.js";
import {
  canonicalArticleUrl,
  canonicalStatusUrl,
  parseTwitterFetchTarget,
} from "./url.js";
import { parseTwitterTarget } from "./twitter-url-discover.js";

type LayerResult =
  | { kind: "success"; value: TwitterFetchSuccess }
  | { kind: "empty"; hint?: TwitterFetchErrorCode }
  | { kind: "fail"; code: TwitterFetchErrorCode; message: string };

async function resolveTco(
  client: TwitterHttpClient,
  code: string,
): Promise<
  | {
      ok: true;
      target:
        | {
            kind: "status";
            statusId: string;
            username: string | null;
            sourceUrl: string;
          }
        | {
            kind: "article";
            articleId: string;
            username: string | null;
            sourceUrl: string;
          };
    }
  | {
      ok: false;
      result:
        | { kind: "empty"; hint?: TwitterFetchErrorCode }
        | { kind: "fail"; code: TwitterFetchErrorCode; message: string };
    }
> {
  const response = await client.getText(`https://t.co/${code}`);
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return {
      ok: false,
      result: {
        kind: "fail",
        code: "rate_limited",
        message: "Twitter rate limited the t.co redirect",
      },
    };
  }
  if (statusKind === "not_found") {
    return {
      ok: false,
      result: {
        kind: "fail",
        code: "not_found",
        message: "t.co short link returned 404",
      },
    };
  }
  if (statusKind !== "ok" && statusKind !== "other") {
    return {
      ok: false,
      result: {
        kind: "empty",
        hint:
          statusKind === "private_or_unavailable"
            ? looksLikeLoginWall(response.text)
              ? "login_wall"
              : "private_or_unavailable"
            : undefined,
      },
    };
  }

  const fromFinal = parseTwitterTarget(response.finalUrl);
  if (fromFinal?.kind === "status") {
    return {
      ok: true,
      target: {
        kind: "status",
        statusId: fromFinal.statusId,
        username: fromFinal.username,
        sourceUrl: canonicalStatusUrl(fromFinal.statusId, fromFinal.username),
      },
    };
  }
  if (fromFinal?.kind === "article") {
    return {
      ok: true,
      target: {
        kind: "article",
        articleId: fromFinal.articleId,
        username: fromFinal.username,
        sourceUrl: canonicalArticleUrl(
          fromFinal.articleId,
          fromFinal.username,
        ),
      },
    };
  }

  const hrefMatch =
    /https?:\/\/(?:www\.)?(?:mobile\.)?(?:x\.com|twitter\.com)\/[^\s"'<>]+/i.exec(
      response.text,
    );
  if (hrefMatch?.[0]) {
    const nested = parseTwitterTarget(hrefMatch[0]);
    if (nested?.kind === "status") {
      return {
        ok: true,
        target: {
          kind: "status",
          statusId: nested.statusId,
          username: nested.username,
          sourceUrl: canonicalStatusUrl(nested.statusId, nested.username),
        },
      };
    }
    if (nested?.kind === "article") {
      return {
        ok: true,
        target: {
          kind: "article",
          articleId: nested.articleId,
          username: nested.username,
          sourceUrl: canonicalArticleUrl(nested.articleId, nested.username),
        },
      };
    }
  }

  return {
    ok: false,
    result: {
      kind: "empty",
      hint: looksLikeLoginWall(response.text) ? "login_wall" : "invalid_url",
    },
  };
}

async function extractStatusFromSyndication(
  client: TwitterHttpClient,
  statusId: string,
  sourceUrl: string,
): Promise<LayerResult> {
  const response = await client.getText(
    syndicationTweetResultUrl(statusId),
    jsonGetHeaders(),
  );
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return {
      kind: "fail",
      code: "rate_limited",
      message: "Twitter syndication rate limited the tweet-result request",
    };
  }
  if (statusKind === "not_found") {
    return {
      kind: "fail",
      code: "not_found",
      message: "Syndication returned 404 for status",
    };
  }
  if (statusKind !== "ok") {
    return {
      kind: "empty",
      hint:
        statusKind === "private_or_unavailable"
          ? looksLikeLoginWall(response.text)
            ? "login_wall"
            : "private_or_unavailable"
          : looksLikeLoginWall(response.text)
            ? "login_wall"
            : undefined,
    };
  }

  if (!response.text.trim() || response.text.trim() === "{}") {
    return { kind: "empty", hint: "not_found" };
  }

  if (looksLikeLoginWall(response.text) && !response.text.trim().startsWith("{")) {
    return { kind: "empty", hint: "login_wall" };
  }

  const json = parseJsonObject(response.text);
  if (!json) {
    return {
      kind: "empty",
      hint: looksLikeLoginWall(response.text) ? "login_wall" : "not_found",
    };
  }

  const parsed = parseStatusFromSyndication(json, statusId, sourceUrl);
  if (!parsed) {
    return { kind: "empty", hint: "not_found" };
  }
  return { kind: "success", value: parsed };
}

async function extractStatusFromPage(
  client: TwitterHttpClient,
  statusId: string,
  username: string | null,
  sourceUrl: string,
): Promise<LayerResult> {
  const pageUrl = canonicalStatusUrl(statusId, username);
  const response = await client.getText(pageUrl);
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return {
      kind: "fail",
      code: "rate_limited",
      message: "Twitter rate limited the status page request",
    };
  }
  if (statusKind === "not_found") {
    return {
      kind: "fail",
      code: "not_found",
      message: "Status page returned 404",
    };
  }
  if (statusKind !== "ok") {
    return {
      kind: "empty",
      hint:
        statusKind === "private_or_unavailable"
          ? looksLikeLoginWall(response.text)
            ? "login_wall"
            : "private_or_unavailable"
          : looksLikeLoginWall(response.text)
            ? "login_wall"
            : undefined,
    };
  }

  // Logged-out x.com HTML is almost always the SPA login shell. Do not report
  // login_wall here — that poisoned pickFinalFailure when syndication 404'd.
  if (looksLikeLoginWall(response.text)) {
    return { kind: "empty" };
  }

  // Secondary layer: embedded syndication-like JSON in page (fixture / rare embeds).
  const embedded =
    /<script[^>]+id=["']collector-twitter-status["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      response.text,
    );
  if (embedded?.[1]) {
    const json = parseJsonObject(embedded[1].trim());
    if (json) {
      const parsed = parseStatusFromSyndication(json, statusId, sourceUrl);
      if (parsed) {
        return { kind: "success", value: parsed };
      }
    }
  }

  return { kind: "empty", hint: "not_found" };
}

async function extractArticleFromPage(
  client: TwitterHttpClient,
  articleId: string,
  username: string | null,
  sourceUrl: string,
): Promise<LayerResult> {
  const response = await client.getText(sourceUrl);
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return {
      kind: "fail",
      code: "rate_limited",
      message: "Twitter rate limited the article page request",
    };
  }
  if (statusKind === "not_found") {
    return {
      kind: "fail",
      code: "not_found",
      message: "Article page returned 404",
    };
  }
  if (statusKind !== "ok") {
    return {
      kind: "empty",
      hint:
        statusKind === "private_or_unavailable"
          ? looksLikeLoginWall(response.text)
            ? "login_wall"
            : "private_or_unavailable"
          : looksLikeLoginWall(response.text)
            ? "login_wall"
            : undefined,
    };
  }

  // X Article SSR often includes login chrome next to real og/article content.
  // Parse first; only treat as login_wall when nothing usable is present.
  const parsed = parseArticleFromHtml(
    response.text,
    articleId,
    username,
    sourceUrl,
  );
  if (parsed) {
    return { kind: "success", value: parsed };
  }
  if (looksLikeLoginWall(response.text)) {
    return { kind: "empty", hint: "login_wall" };
  }
  return { kind: "empty", hint: "not_found" };
}

const ERROR_PRIORITY: TwitterFetchErrorCode[] = [
  "rate_limited",
  "login_wall",
  "not_found",
  "private_or_unavailable",
  "invalid_url",
];

function pickFinalFailure(
  failures: Array<{ code: TwitterFetchErrorCode; message: string }>,
): TwitterFetchResult {
  if (failures.length === 0) {
    return {
      ok: false,
      code: "not_found",
      message: "All Twitter extraction layers returned no usable content",
    };
  }

  for (const code of ERROR_PRIORITY) {
    for (let i = failures.length - 1; i >= 0; i -= 1) {
      const entry = failures[i];
      if (entry && entry.code === code) {
        return { ok: false, code: entry.code, message: entry.message };
      }
    }
  }

  return {
    ok: false,
    code: failures[failures.length - 1]!.code,
    message: failures[failures.length - 1]!.message,
  };
}

/**
 * Fetch Twitter/X status or article metadata via logged-out multi-layer strategy.
 */
export async function fetchTwitterContent(
  urlOrId: string,
  options: FetchTwitterContentOptions = {},
): Promise<TwitterFetchResult> {
  const target = parseTwitterFetchTarget(urlOrId);
  if (!target) {
    return {
      ok: false,
      code: "invalid_url",
      message: `Not a supported Twitter/X status, article, or t.co URL: ${urlOrId}`,
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "fetchTwitterContent: fetchImpl is required (no global fetch available)",
    );
  }

  const client = createTwitterHttpClient({ fetchImpl });

  let resolved:
    | {
        kind: "status";
        statusId: string;
        username: string | null;
        sourceUrl: string;
      }
    | {
        kind: "article";
        articleId: string;
        username: string | null;
        sourceUrl: string;
      };

  if (target.kind === "tco") {
    const short = await resolveTco(client, target.code);
    if (!short.ok) {
      if (short.result.kind === "fail") {
        return {
          ok: false,
          code: short.result.code,
          message: short.result.message,
        };
      }
      return {
        ok: false,
        code: short.result.hint ?? "invalid_url",
        message: `t.co resolve failed (${short.result.hint ?? "invalid_url"})`,
      };
    }
    resolved = short.target;
  } else if (target.kind === "status") {
    resolved = {
      kind: "status",
      statusId: target.statusId,
      username: target.username,
      sourceUrl: target.sourceUrl,
    };
  } else {
    resolved = {
      kind: "article",
      articleId: target.articleId,
      username: target.username,
      sourceUrl: target.sourceUrl,
    };
  }

  const layers: Array<() => Promise<LayerResult>> = [];
  if (resolved.kind === "status") {
    const statusId = resolved.statusId;
    const username = resolved.username;
    const sourceUrl = resolved.sourceUrl;
    layers.push(() =>
      extractStatusFromSyndication(client, statusId, sourceUrl),
    );
    layers.push(() =>
      extractStatusFromPage(client, statusId, username, sourceUrl),
    );
  } else {
    const articleId = resolved.articleId;
    const username = resolved.username;
    const sourceUrl = resolved.sourceUrl;
    layers.push(() =>
      extractArticleFromPage(client, articleId, username, sourceUrl),
    );
  }

  const failures: Array<{ code: TwitterFetchErrorCode; message: string }> =
    [];

  for (const run of layers) {
    const result = await run();
    if (result.kind === "success") {
      return { ok: true, value: result.value };
    }
    if (result.kind === "fail") {
      if (result.code === "rate_limited") {
        return { ok: false, code: result.code, message: result.message };
      }
      failures.push({ code: result.code, message: result.message });
      continue;
    }
    if (result.hint) {
      failures.push({
        code: result.hint,
        message: `Layer yielded no content (${result.hint})`,
      });
    }
  }

  return pickFinalFailure(failures);
}
