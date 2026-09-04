/**
 * Syndication tweet-result token (#954) — same formula as X embed / react-tweet.
 */

/** Feature flags required by tweet-result (same set as vercel/react-tweet). */
export const SYNDICATION_TWEET_FEATURES = [
  "tfw_timeline_list:",
  "tfw_follower_count_sunset:true",
  "tfw_tweet_edit_backend:on",
  "tfw_refsrc_session:on",
  "tfw_fosnr_soft_interventions_enabled:on",
  "tfw_show_birdwatch_pivots_enabled:on",
  "tfw_show_business_verified_badge:on",
  "tfw_duplicate_scribes_to_settings:on",
  "tfw_use_profile_image_shape_enabled:on",
  "tfw_show_blue_verified_badge:on",
  "tfw_legacy_timeline_sunset:true",
  "tfw_show_gov_verified_badge:on",
  "tfw_show_business_affiliate_badge:on",
  "tfw_tweet_edit_frontend:on",
].join(";");

export function syndicationTweetToken(statusId: string): string {
  if (!/^\d+$/.test(statusId)) {
    throw new Error(
      `syndicationTweetToken: status id must be numeric, got ${statusId}`,
    );
  }
  return ((Number(statusId) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, "");
}

export function syndicationTweetResultUrl(statusId: string): string {
  const url = new URL("https://cdn.syndication.twimg.com/tweet-result");
  url.searchParams.set("id", statusId);
  url.searchParams.set("lang", "en");
  url.searchParams.set("features", SYNDICATION_TWEET_FEATURES);
  url.searchParams.set("token", syndicationTweetToken(statusId));
  return url.toString();
}
