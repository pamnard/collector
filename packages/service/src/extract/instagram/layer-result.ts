/**
 * Layer outcomes for the Instagram multi-layer fetch chain.
 */

import type { InstagramFetchErrorCode, InstagramFetchSuccess } from "./types.js";

export type LayerSuccess = {
  kind: "success";
  value: InstagramFetchSuccess;
};

export type LayerEmpty = {
  kind: "empty";
  /** Optional signal used when every layer is empty. */
  hint?: InstagramFetchErrorCode;
};

export type LayerFail = {
  kind: "fail";
  code: InstagramFetchErrorCode;
  message: string;
};

export type LayerResult = LayerSuccess | LayerEmpty | LayerFail;

export function layerSuccess(value: InstagramFetchSuccess): LayerSuccess {
  return { kind: "success", value };
}

export function layerEmpty(hint?: InstagramFetchErrorCode): LayerEmpty {
  return hint ? { kind: "empty", hint } : { kind: "empty" };
}

export function layerFail(
  code: InstagramFetchErrorCode,
  message: string,
): LayerFail {
  return { kind: "fail", code, message };
}
