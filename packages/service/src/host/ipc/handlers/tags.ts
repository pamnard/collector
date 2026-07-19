/**
 * IPC handlers: tags list/CRUD (#157).
 */

import {
  asObject,
  badRequest,
  requireString,
} from "./params.js";
import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";

export function buildTagsHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const { tagsFolders } = runtime;
  const M = DOMAIN_IPC_METHODS;

  return {
    [M.listTags]: async () => {
      await runtime.ensureInitialized();
      return tagsFolders.listTags();
    },
    [M.createTag]: async (params) => {
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
      return tagsFolders.createTag({ name, color });
    },
    [M.updateTagRecord]: async (params) => {
      const p = asObject(params, M.updateTagRecord);
      const tagId = requireString(p.tagId, "tagId", M.updateTagRecord);
      if (!p.input || typeof p.input !== "object" || Array.isArray(p.input)) {
        badRequest(`${M.updateTagRecord}: input object required`);
      }
      const input = p.input as Record<string, unknown>;
      const patch: { name?: string; color?: string | null } = {};
      if (input.name !== undefined) {
        if (typeof input.name !== "string" || input.name.length === 0) {
          badRequest(`${M.updateTagRecord}: input.name must be a non-empty string`);
        }
        patch.name = input.name;
      }
      if (input.color !== undefined) {
        if (input.color !== null && typeof input.color !== "string") {
          badRequest(`${M.updateTagRecord}: input.color must be string or null`);
        }
        patch.color = input.color as string | null;
      }
      await runtime.ensureInitialized();
      return tagsFolders.updateTagRecord(tagId, patch);
    },
    [M.deleteTag]: async (params) => {
      const p = asObject(params, M.deleteTag);
      const tagId = requireString(p.tagId, "tagId", M.deleteTag);
      await runtime.ensureInitialized();
      await tagsFolders.deleteTag(tagId);
      return { ok: true };
    },
  };
}
