/**
 * Multi-layer Pinterest pin fetch (#34).
 * HTTP is injected; CI uses committed fixtures only.
 */

import {
  classifyHttpStatus,
  createPinterestHttpClient,
  jsonGetHeaders,
  looksLikeLoginWall,
  pinPageUrl,
  pinResourceUrl,
  type PinterestHttpClient,
} from "./http.js";
import { parseJsonObject } from "../json-unknown.js";
import { parsePinFromHtml, parsePinResourceData, toFetchSuccess } from "./parse-pin.js";
import type {
  FetchPinterestPinOptions,
  PinterestFetchErrorCode,
  PinterestFetchResult,
  PinterestFetchSuccess,
} from "./types.js";
import { canonicalPinUrl, parsePinterestTarget } from "./url.js";

type LayerResult =
  | { kind: "success"; value: PinterestFetchSuccess }
  | { kind: "empty"; hint?: PinterestFetchErrorCode }
  | { kind: "fail"; code: PinterestFetchErrorCode; message: string };

async function resolvePinIt(
  client: PinterestHttpClient,
  code: string,
): Promise<
  | { ok: true; pinId: string; sourceUrl: string }
  | {
      ok: false;
      result:
        | { kind: "empty"; hint?: PinterestFetchErrorCode }
        | { kind: "fail"; code: PinterestFetchErrorCode; message: string };
    }
> {
  const response = await client.getText(`https://pin.it/${code}`);
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return {
      ok: false,
      result: {
        kind: "fail",
        code: "rate_limited",
        message: "Pinterest rate limited the pin.it redirect",
      },
    };
  }
  if (statusKind === "not_found") {
    return {
      ok: false,
      result: {
        kind: "fail",
        code: "not_found",
        message: "pin.it short link returned 404",
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

  const finalTarget = parsePinterestTarget(response.finalUrl);
  if (finalTarget?.kind === "pin") {
    return {
      ok: true,
      pinId: finalTarget.pinId,
      sourceUrl: canonicalPinUrl(finalTarget.pinId),
    };
  }

  // Some fixtures return 200 HTML without updating response.url — scan redirects in body.
  const hrefMatch =
    /url=https?:\/\/[^"'>\s]*pinterest\.com\/pin\/([^"'/\s]+)/i.exec(
      response.text,
    ) ??
    /https?:\/\/(?:www\.)?(?:[a-z]+\.)?pinterest\.com\/pin\/([^"'/\s]+)/i.exec(
      response.text,
    );
  if (hrefMatch?.[1]) {
    const pinIdMatch = parsePinterestTarget(
      `https://www.pinterest.com/pin/${hrefMatch[1]}/`,
    );
    if (pinIdMatch?.kind === "pin") {
      return {
        ok: true,
        pinId: pinIdMatch.pinId,
        sourceUrl: canonicalPinUrl(pinIdMatch.pinId),
      };
    }
  }

  return {
    ok: false,
    result: {
      kind: "empty",
      hint: looksLikeLoginWall(response.text) ? "login_wall" : "no_media",
    },
  };
}

async function extractFromHtml(
  client: PinterestHttpClient,
  pinId: string,
  sourceUrl: string,
): Promise<LayerResult> {
  const response = await client.getText(pinPageUrl(pinId));
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return {
      kind: "fail",
      code: "rate_limited",
      message: "Pinterest rate limited the pin page request",
    };
  }
  if (statusKind === "not_found") {
    return {
      kind: "fail",
      code: "not_found",
      message: "Pinterest returned 404 for pin page",
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

  const parsed = parsePinFromHtml(response.text, pinId);
  if (!parsed) {
    return {
      kind: "empty",
      hint: looksLikeLoginWall(response.text) ? "login_wall" : "no_media",
    };
  }
  return { kind: "success", value: toFetchSuccess(parsed, sourceUrl) };
}

async function extractFromPinResource(
  client: PinterestHttpClient,
  pinId: string,
  sourceUrl: string,
): Promise<LayerResult> {
  const response = await client.getText(pinResourceUrl(pinId), jsonGetHeaders());
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return {
      kind: "fail",
      code: "rate_limited",
      message: "Pinterest rate limited PinResource",
    };
  }
  if (statusKind === "not_found") {
    return {
      kind: "fail",
      code: "not_found",
      message: "PinResource returned 404",
    };
  }
  if (statusKind !== "ok") {
    return {
      kind: "empty",
      hint:
        statusKind === "private_or_unavailable"
          ? "private_or_unavailable"
          : undefined,
    };
  }

  const json = parseJsonObject(response.text);
  if (!json) {
    return { kind: "empty", hint: "no_media" };
  }
  const parsed = parsePinResourceData(json, pinId);
  if (!parsed) {
    return { kind: "empty", hint: "no_media" };
  }
  return { kind: "success", value: toFetchSuccess(parsed, sourceUrl) };
}

const ERROR_PRIORITY: PinterestFetchErrorCode[] = [
  "rate_limited",
  "login_wall",
  "not_found",
  "private_or_unavailable",
  "no_media",
  "invalid_url",
];

function pickFinalFailure(
  failures: Array<{ code: PinterestFetchErrorCode; message: string }>,
): PinterestFetchResult {
  if (failures.length === 0) {
    return {
      ok: false,
      code: "no_media",
      message: "All Pinterest extraction layers returned no downloadable media",
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
 * Fetch Pinterest pin media metadata via logged-out multi-layer strategy.
 */
export async function fetchPinterestPin(
  urlOrPinId: string,
  options: FetchPinterestPinOptions = {},
): Promise<PinterestFetchResult> {
  const target = parsePinterestTarget(urlOrPinId);
  if (!target) {
    return {
      ok: false,
      code: "invalid_url",
      message: `Not a supported Pinterest pin / pin.it URL: ${urlOrPinId}`,
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "fetchPinterestPin: fetchImpl is required (no global fetch available)",
    );
  }

  const client = createPinterestHttpClient({ fetchImpl });

  let pinId: string;
  let sourceUrl: string;
  if (target.kind === "pinit") {
    const resolved = await resolvePinIt(client, target.code);
    if (!resolved.ok) {
      if (resolved.result.kind === "fail") {
        return {
          ok: false,
          code: resolved.result.code,
          message: resolved.result.message,
        };
      }
      return {
        ok: false,
        code: resolved.result.hint ?? "no_media",
        message: `pin.it resolve failed (${resolved.result.hint ?? "no_media"})`,
      };
    }
    pinId = resolved.pinId;
    sourceUrl = resolved.sourceUrl;
  } else {
    pinId = target.pinId;
    sourceUrl = target.sourceUrl;
  }

  const layers: Array<() => Promise<LayerResult>> = [
    () => extractFromHtml(client, pinId, sourceUrl),
    () => extractFromPinResource(client, pinId, sourceUrl),
  ];

  const failures: Array<{ code: PinterestFetchErrorCode; message: string }> =
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
        message: `Layer yielded no media (${result.hint})`,
      });
    }
  }

  return pickFinalFailure(failures);
}
