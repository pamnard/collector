/**
 * Shared IPC params helpers for domain handlers.
 */

import type { NavFilter } from "@collector/api";
import { serviceIpcError } from "../errors.js";

export function badRequest(message: string): never {
  throw serviceIpcError({
    layer: "validation",
    code: "bad_request",
    message,
  });
}

export function asObject(
  params: unknown,
  method: string,
): Record<string, unknown> {
  if (params === undefined || params === null) {
    return {};
  }
  if (typeof params !== "object" || Array.isArray(params)) {
    badRequest(`${method}: params must be an object`);
  }
  return params as Record<string, unknown>;
}

export function requireString(
  value: unknown,
  field: string,
  method: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    badRequest(`${method}: ${field} must be a non-empty string`);
  }
  return value;
}

export function parseNavFilter(value: unknown, method: string): NavFilter {
  if (value === "all") {
    return "all";
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj.type === "tag" && typeof obj.tagId === "string") {
      return { type: "tag", tagId: obj.tagId };
    }
    if (obj.type === "folder" && typeof obj.folderPath === "string") {
      return { type: "folder", folderPath: obj.folderPath };
    }
  }
  badRequest(`${method}: invalid NavFilter`);
}
