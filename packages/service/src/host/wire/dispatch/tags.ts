import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, badRequest, requireString } from "../handlers/params.js";
import { defineDispatch } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

/** Tags (#157). */
export const TAGS_DISPATCH = defineDispatch({
  [M.listTags]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.tagsFolders.listTags();
    },
  },
  [M.createTag]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.createTag);
      const name = requireString(p.name, "name", M.createTag);
      const color =
        p.color === undefined
          ? undefined
          : p.color === null
            ? null
            : typeof p.color === "string"
              ? p.color
              : badRequest(`${M.createTag}: color must be string or null`);
      await runtime.ensureInitialized();
      return runtime.tagsFolders.createTag({ name, color });
    },
  },
  [M.updateTagRecord]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.updateTagRecord);
      const tagId = requireString(p.tagId, "tagId", M.updateTagRecord);
      if (!p.input || typeof p.input !== "object" || Array.isArray(p.input)) {
        badRequest(`${M.updateTagRecord}: input object required`);
      }
      const input = p.input as Record<string, unknown>;
      const patch: { name?: string; color?: string | null } = {};
      if (input.name !== undefined) {
        if (typeof input.name !== "string" || input.name.length === 0) {
          badRequest(
            `${M.updateTagRecord}: input.name must be a non-empty string`,
          );
        }
        patch.name = input.name;
      }
      if (input.color !== undefined) {
        if (input.color !== null && typeof input.color !== "string") {
          badRequest(
            `${M.updateTagRecord}: input.color must be string or null`,
          );
        }
        patch.color = input.color as string | null;
      }
      await runtime.ensureInitialized();
      return runtime.tagsFolders.updateTagRecord(tagId, patch);
    },
  },
  [M.deleteTag]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.deleteTag);
      const tagId = requireString(p.tagId, "tagId", M.deleteTag);
      await runtime.ensureInitialized();
      await runtime.tagsFolders.deleteTag(tagId);
      return { ok: true };
    },
  },
});
