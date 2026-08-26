import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, requireString, badRequest } from "../handlers/params.js";
import type { ExtractCandidate } from "@collector/api";
import type { DomainDispatchGroup } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

function parseExtractCandidate(
  value: unknown,
  method: string,
): ExtractCandidate {
  if (value === undefined || value === null) {
    badRequest(`${method}: candidate is required`);
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    badRequest(`${method}: candidate must be an object`);
  }
  const obj = value as Record<string, unknown>;
  const extractorId = requireString(obj.extractorId, "candidate.extractorId", method);
  const url = requireString(obj.url, "candidate.url", method);
  if (obj.meta === undefined || obj.meta === null) {
    return { extractorId, url };
  }
  if (typeof obj.meta !== "object" || Array.isArray(obj.meta)) {
    badRequest(`${method}: candidate.meta must be a string map`);
  }
  const meta: Record<string, string> = {};
  for (const [key, entry] of Object.entries(obj.meta as Record<string, unknown>)) {
    if (typeof entry !== "string") {
      badRequest(`${method}: candidate.meta values must be strings`);
    }
    meta[key] = entry;
  }
  return { extractorId, url, meta };
}

export const EXTRACT_DISPATCH = {
  [M.discoverExtractCandidates]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.discoverExtractCandidates);
      const itemId = requireString(
        p.itemId,
        "itemId",
        M.discoverExtractCandidates,
      );
      await runtime.ensureInitialized();
      return runtime.extract.discoverExtractCandidates(itemId);
    },
  },
  [M.extractItemCandidate]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.extractItemCandidate);
      const itemId = requireString(p.itemId, "itemId", M.extractItemCandidate);
      const candidate = parseExtractCandidate(p.candidate, M.extractItemCandidate);
      await runtime.ensureInitialized();
      await runtime.extract.extractItemCandidate(itemId, candidate);
      return { ok: true };
    },
  },
} satisfies DomainDispatchGroup;
