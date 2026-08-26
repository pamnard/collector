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
import {
  layerEmpty,
  layerFail,
  layerSuccess,
  type LayerResult,
} from "./layer-result.js";
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

function toSuccess(
  fields: ParsedMediaFields,
  sourceUrl: string,
): InstagramFetchSuccess {
  return { sourceUrl, ...fields };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

async function extractFromEmbed(
  client: InstagramHttpClient,
  shortcode: string,
  sourceUrl: string,
): Promise<LayerResult> {
  const url = `${IG_WEB_ORIGIN}/p/${shortcode}/embed/`;
  const response = await client.getText(url);
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return layerFail("rate_limited", "Instagram rate limited the embed request");
  }
  if (statusKind === "not_found") {
    return layerFail("not_found", "Instagram embed returned 404");
  }
  if (statusKind === "private_or_unavailable") {
    return layerEmpty(
      looksLikeLoginWall(response.text) ? "login_wall" : "private_or_unavailable",
    );
  }
  if (statusKind !== "ok") {
    return layerEmpty(
      looksLikeLoginWall(response.text) ? "login_wall" : undefined,
    );
  }

  if (looksLikeLoginWall(response.text) && !response.text.includes("contextJSON")) {
    return layerEmpty("login_wall");
  }

  let media: unknown = null;
  try {
    media = extractContextJsonMedia(response.text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      media = null;
    } else {
      throw error;
    }
  }

  if (!media) {
    return layerEmpty(
      looksLikeLoginWall(response.text) ? "login_wall" : "no_media",
    );
  }

  const parsed = parseGraphqlShortcodeMedia(media, shortcode);
  if (!parsed) {
    return layerEmpty("no_media");
  }
  return layerSuccess(toSuccess(parsed, sourceUrl));
}

async function extractFromPolaris(
  client: InstagramHttpClient,
  shortcode: string,
  sourceUrl: string,
): Promise<LayerResult> {
  const homepage = await client.getText(`${IG_WEB_ORIGIN}/`);
  const homeStatus = classifyHttpStatus(homepage.status);
  if (homeStatus === "rate_limited") {
    return layerFail(
      "rate_limited",
      "Instagram rate limited the Polaris session bootstrap",
    );
  }
  if (homeStatus !== "ok") {
    return layerEmpty();
  }

  let lsdToken: string | null = null;
  try {
    lsdToken = extractLsdToken(homepage.text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      lsdToken = null;
    } else {
      throw error;
    }
  }
  if (!lsdToken) {
    return layerEmpty();
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
    return layerFail(
      "rate_limited",
      "Instagram rate limited the Polaris ruling request",
    );
  }
  if (rulingStatus === "not_found") {
    return layerFail("not_found", "Polaris ruling returned 404");
  }
  if (rulingStatus !== "ok") {
    return layerEmpty(
      rulingStatus === "private_or_unavailable"
        ? "private_or_unavailable"
        : undefined,
    );
  }

  const ruling = parseJsonObject(rulingResponse.text);
  if (!ruling || ruling.status !== "ok") {
    return layerEmpty("private_or_unavailable");
  }

  const csrf = client.cookies.get("csrftoken");
  if (!csrf) {
    return layerEmpty();
  }

  const headers = apiHeaders(client.cookies, {
    "X-FB-Friendly-Name": LOGGED_OUT_QUERY_NAME,
    "X-FB-LSD": lsdToken,
    "X-Requested-With": "XMLHttpRequest",
    Referer: `${IG_WEB_ORIGIN}/reel/${shortcode}/`,
  });

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
    headers,
  );

  const gqlStatus = classifyHttpStatus(graphqlResponse.status);
  if (gqlStatus === "rate_limited") {
    return layerFail(
      "rate_limited",
      "Instagram rate limited the Polaris GraphQL request",
    );
  }
  if (gqlStatus !== "ok") {
    return layerEmpty(
      gqlStatus === "private_or_unavailable"
        ? "private_or_unavailable"
        : gqlStatus === "not_found"
          ? "not_found"
          : undefined,
    );
  }

  const envelope = parseJsonObject(graphqlResponse.text);
  if (!envelope) {
    return layerEmpty();
  }

  const data = envelope.data;
  const dataRow =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const polaris = dataRow?.xig_polaris_media;
  const polarisRow =
    polaris !== null && typeof polaris === "object" && !Array.isArray(polaris)
      ? (polaris as Record<string, unknown>)
      : null;
  const product = polarisRow?.if_not_gated_logged_out;
  if (!product) {
    return layerEmpty("login_wall");
  }

  const parsed = parseApiMediaItem(product, shortcode);
  if (!parsed) {
    return layerEmpty("no_media");
  }
  return layerSuccess(toSuccess(parsed, sourceUrl));
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
    return layerFail(
      "rate_limited",
      "Instagram rate limited the legacy GraphQL request",
    );
  }
  if (statusKind === "not_found") {
    return layerFail("not_found", "Legacy GraphQL returned 404");
  }
  if (statusKind !== "ok") {
    return layerEmpty(
      statusKind === "private_or_unavailable"
        ? "private_or_unavailable"
        : undefined,
    );
  }

  const envelope = parseJsonObject(response.text);
  if (!envelope) {
    return layerEmpty();
  }
  const data = envelope.data;
  const dataRow =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const media = dataRow?.xdt_shortcode_media;
  if (!media) {
    return layerEmpty("no_media");
  }

  const parsed = parseGraphqlShortcodeMedia(media, shortcode);
  if (!parsed) {
    return layerEmpty("no_media");
  }
  return layerSuccess(toSuccess(parsed, sourceUrl));
}

async function extractFromMobileApi(
  client: InstagramHttpClient,
  shortcode: string,
  sourceUrl: string,
): Promise<LayerResult> {
  // Warm cookies / CSRF the same way open-source extractors do.
  await client.getText(`${IG_WEB_ORIGIN}/p/${shortcode}/`);

  const mediaId = shortcodeToMediaId(shortcode);
  const apiUrl = `${IG_API_BASE}/media/${mediaId}/info/`;
  const response = await client.getText(apiUrl, apiHeaders(client.cookies));
  const statusKind = classifyHttpStatus(response.status);
  if (statusKind === "rate_limited") {
    return layerFail(
      "rate_limited",
      "Instagram rate limited the mobile media info request",
    );
  }
  if (statusKind === "not_found") {
    return layerFail("not_found", "Mobile media info returned 404");
  }
  if (statusKind !== "ok") {
    return layerEmpty(
      statusKind === "private_or_unavailable"
        ? "private_or_unavailable"
        : undefined,
    );
  }

  const envelope = parseJsonObject(response.text);
  if (!envelope) {
    return layerEmpty();
  }
  const items = envelope.items;
  if (!Array.isArray(items) || items.length === 0) {
    return layerEmpty("no_media");
  }

  const parsed = parseApiMediaItem(items[0], shortcode);
  if (!parsed) {
    return layerEmpty("no_media");
  }
  return layerSuccess(toSuccess(parsed, sourceUrl));
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
    const match = [...failures].reverse().find((entry) => entry.code === code);
    if (match) {
      return { ok: false, code: match.code, message: match.message };
    }
  }

  const last = failures[failures.length - 1]!;
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
      if (result.value.media.length === 0) {
        failures.push({
          code: "no_media",
          message: "Extraction succeeded with an empty media list",
        });
        continue;
      }
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
