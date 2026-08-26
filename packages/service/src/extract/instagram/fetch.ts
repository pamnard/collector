/**
 * Multi-layer Instagram media fetch (port of parth-dl / yt-dlp-family strategy).
 * HTTP is injected; CI uses committed fixtures only.
 */

import {
  IG_API_BASE,
  IG_WEB_ORIGIN,
  LEGACY_SHORTCODE_DOC_ID,
  LOGGED_OUT_QUERY_DOC_ID,
  LOGGED_OUT_QUERY_NAME,
  apiHeaders,
  classifyHttpStatus,
  createInstagramHttpClient,
  extractContextJsonMedia,
  extractLsdToken,
  looksLikeLoginWall,
  type InstagramHttpClient,
} from "./http.js";
import { asRecord, parseJsonObject } from "./json-unknown.js";
import { shortcodeToMediaId } from "./media-id.js";
import {
  parseApiMediaItem,
  parseGraphqlShortcodeMedia,
  type ParsedMediaFields,
} from "./parse-media.js";
import type {
  FetchInstagramMediaOptions,
  InstagramFetchErrorCode,
  InstagramFetchResult,
  InstagramFetchSuccess,
} from "./types.js";
import { parseInstagramTarget } from "./url.js";

type LayerResult =
  | { kind: "success"; value: InstagramFetchSuccess }
  | { kind: "empty"; hint?: InstagramFetchErrorCode }
  | { kind: "fail"; code: InstagramFetchErrorCode; message: string };

function toSuccess(
  fields: ParsedMediaFields,
  sourceUrl: string,
): InstagramFetchSuccess {
  return { sourceUrl, ...fields };
}

function emptyFromStatus(
  statusKind: Exclude<ReturnType<typeof classifyHttpStatus>, "ok" | "rate_limited">,
  bodyText?: string,
): LayerResult {
  if (statusKind === "not_found") {
    return {
      kind: "fail",
      code: "not_found",
      message: "Instagram returned 404",
    };
  }
  if (statusKind === "private_or_unavailable") {
    return {
      kind: "empty",
      hint:
        bodyText && looksLikeLoginWall(bodyText)
          ? "login_wall"
          : "private_or_unavailable",
    };
  }
  return {
    kind: "empty",
    hint: bodyText && looksLikeLoginWall(bodyText) ? "login_wall" : undefined,
  };
}

async function extractFromEmbed(
  client: InstagramHttpClient,
  shortcode: string,
  sourceUrl: string,
): Promise<LayerResult> {
  const response = await client.getText(
    `${IG_WEB_ORIGIN}/p/${shortcode}/embed/`,
  );
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return {
      kind: "fail",
      code: "rate_limited",
      message: "Instagram rate limited the embed request",
    };
  }
  if (statusKind !== "ok") {
    return emptyFromStatus(statusKind, response.text);
  }

  if (
    looksLikeLoginWall(response.text) &&
    !response.text.includes("contextJSON")
  ) {
    return { kind: "empty", hint: "login_wall" };
  }

  const media = extractContextJsonMedia(response.text);
  if (!media) {
    return {
      kind: "empty",
      hint: looksLikeLoginWall(response.text) ? "login_wall" : "no_media",
    };
  }

  const parsed = parseGraphqlShortcodeMedia(media, shortcode);
  if (!parsed) {
    return { kind: "empty", hint: "no_media" };
  }
  return { kind: "success", value: toSuccess(parsed, sourceUrl) };
}

async function extractFromPolaris(
  client: InstagramHttpClient,
  shortcode: string,
  sourceUrl: string,
): Promise<LayerResult> {
  const homepage = await client.getText(`${IG_WEB_ORIGIN}/`);
  const homeStatus = classifyHttpStatus(homepage.status);
  if (homeStatus === "rate_limited") {
    return {
      kind: "fail",
      code: "rate_limited",
      message: "Instagram rate limited the Polaris session bootstrap",
    };
  }
  if (homeStatus !== "ok") {
    return { kind: "empty" };
  }

  const lsdToken = extractLsdToken(homepage.text);
  if (!lsdToken) {
    return { kind: "empty" };
  }

  const mediaId = shortcodeToMediaId(shortcode);
  const rulingUrl =
    `${IG_API_BASE}/web/get_ruling_for_content/?` +
    new URLSearchParams({
      content_type: "MEDIA",
      target_id: mediaId,
    }).toString();

  const rulingResponse = await client.getText(
    rulingUrl,
    apiHeaders(client.cookies),
  );
  const rulingStatus = classifyHttpStatus(rulingResponse.status);
  if (rulingStatus === "rate_limited") {
    return {
      kind: "fail",
      code: "rate_limited",
      message: "Instagram rate limited the Polaris ruling request",
    };
  }
  if (rulingStatus !== "ok") {
    return emptyFromStatus(rulingStatus);
  }

  const ruling = parseJsonObject(rulingResponse.text);
  if (!ruling || ruling.status !== "ok") {
    return { kind: "empty", hint: "private_or_unavailable" };
  }

  if (!client.cookies.get("csrftoken")) {
    return { kind: "empty" };
  }

  const graphqlResponse = await client.postForm(
    `${IG_WEB_ORIGIN}/api/graphql`,
    {
      lsd: lsdToken,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: LOGGED_OUT_QUERY_NAME,
      server_timestamps: "true",
      variables: JSON.stringify({ media_id: mediaId }),
      doc_id: LOGGED_OUT_QUERY_DOC_ID,
    },
    apiHeaders(client.cookies, {
      "X-FB-Friendly-Name": LOGGED_OUT_QUERY_NAME,
      "X-FB-LSD": lsdToken,
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${IG_WEB_ORIGIN}/reel/${shortcode}/`,
    }),
  );

  const gqlStatus = classifyHttpStatus(graphqlResponse.status);
  if (gqlStatus === "rate_limited") {
    return {
      kind: "fail",
      code: "rate_limited",
      message: "Instagram rate limited the Polaris GraphQL request",
    };
  }
  if (gqlStatus !== "ok") {
    return emptyFromStatus(gqlStatus);
  }

  const envelope = parseJsonObject(graphqlResponse.text);
  const product = asRecord(
    asRecord(asRecord(envelope)?.data)?.xig_polaris_media,
  )?.if_not_gated_logged_out;
  if (!product) {
    return { kind: "empty", hint: "login_wall" };
  }

  const parsed = parseApiMediaItem(product, shortcode);
  if (!parsed) {
    return { kind: "empty", hint: "no_media" };
  }
  return { kind: "success", value: toSuccess(parsed, sourceUrl) };
}

async function extractFromLegacyGraphql(
  client: InstagramHttpClient,
  shortcode: string,
  sourceUrl: string,
): Promise<LayerResult> {
  const variables = {
    shortcode,
    child_comment_count: 0,
    fetch_comment_count: 0,
    parent_comment_count: 0,
    has_threaded_comments: false,
  };
  const queryUrl =
    `${IG_WEB_ORIGIN}/graphql/query/?doc_id=${LEGACY_SHORTCODE_DOC_ID}` +
    `&variables=${encodeURIComponent(JSON.stringify(variables))}`;

  const response = await client.getText(
    queryUrl,
    apiHeaders(client.cookies, {
      "X-Requested-With": "XMLHttpRequest",
    }),
  );
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return {
      kind: "fail",
      code: "rate_limited",
      message: "Instagram rate limited the legacy GraphQL request",
    };
  }
  if (statusKind !== "ok") {
    return emptyFromStatus(statusKind);
  }

  const media = asRecord(parseJsonObject(response.text)?.data)
    ?.xdt_shortcode_media;
  if (!media) {
    return { kind: "empty", hint: "no_media" };
  }

  const parsed = parseGraphqlShortcodeMedia(media, shortcode);
  if (!parsed) {
    return { kind: "empty", hint: "no_media" };
  }
  return { kind: "success", value: toSuccess(parsed, sourceUrl) };
}

async function extractFromMobileApi(
  client: InstagramHttpClient,
  shortcode: string,
  sourceUrl: string,
): Promise<LayerResult> {
  // Warm cookies / CSRF the same way open-source extractors do.
  await client.getText(`${IG_WEB_ORIGIN}/p/${shortcode}/`);

  const mediaId = shortcodeToMediaId(shortcode);
  const response = await client.getText(
    `${IG_API_BASE}/media/${mediaId}/info/`,
    apiHeaders(client.cookies),
  );
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return {
      kind: "fail",
      code: "rate_limited",
      message: "Instagram rate limited the mobile media info request",
    };
  }
  if (statusKind !== "ok") {
    return emptyFromStatus(statusKind);
  }

  const items = parseJsonObject(response.text)?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { kind: "empty", hint: "no_media" };
  }

  const parsed = parseApiMediaItem(items[0], shortcode);
  if (!parsed) {
    return { kind: "empty", hint: "no_media" };
  }
  return { kind: "success", value: toSuccess(parsed, sourceUrl) };
}

const ERROR_PRIORITY: InstagramFetchErrorCode[] = [
  "rate_limited",
  "login_wall",
  "not_found",
  "private_or_unavailable",
  "no_media",
  "invalid_url",
];

function pickFinalFailure(
  failures: Array<{ code: InstagramFetchErrorCode; message: string }>,
): InstagramFetchResult {
  if (failures.length === 0) {
    return {
      ok: false,
      code: "no_media",
      message:
        "All Instagram extraction layers returned no downloadable media",
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

  const last = failures[failures.length - 1];
  if (!last) {
    return {
      ok: false,
      code: "no_media",
      message:
        "All Instagram extraction layers returned no downloadable media",
    };
  }
  return { ok: false, code: last.code, message: last.message };
}

/**
 * Fetch Instagram post/reel media metadata via logged-out multi-layer strategy.
 */
export async function fetchInstagramMedia(
  urlOrShortcode: string,
  options: FetchInstagramMediaOptions = {},
): Promise<InstagramFetchResult> {
  const target = parseInstagramTarget(urlOrShortcode);
  if (!target) {
    return {
      ok: false,
      code: "invalid_url",
      message: `Not a supported Instagram post/reel URL or shortcode: ${urlOrShortcode}`,
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "fetchInstagramMedia: fetchImpl is required (no global fetch available)",
    );
  }

  const client = createInstagramHttpClient({
    fetchImpl,
    cookies: options.cookies,
  });

  const layers: Array<() => Promise<LayerResult>> = [
    () => extractFromEmbed(client, target.shortcode, target.sourceUrl),
    () => extractFromPolaris(client, target.shortcode, target.sourceUrl),
    () => extractFromLegacyGraphql(client, target.shortcode, target.sourceUrl),
    () => extractFromMobileApi(client, target.shortcode, target.sourceUrl),
  ];

  const failures: Array<{ code: InstagramFetchErrorCode; message: string }> =
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
