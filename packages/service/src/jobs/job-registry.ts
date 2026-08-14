import type { JobTypeDef } from "@collector/shared";
import type { z } from "zod";
import type {
  JobHandler,
  JobHandlerInput,
  JobHandlerResult,
} from "./job-types.js";

export type TypedJobHandler<T extends z.ZodTypeAny> = (
  job: Omit<JobHandlerInput, "payload"> & { payload: z.infer<T> },
) => Promise<JobHandlerResult>;

export interface JobRegistryEntry {
  type: JobTypeDef;
  handler: JobHandler;
}

export interface JobRegistry {
  register<T extends z.ZodTypeAny>(
    type: JobTypeDef<T>,
    handler: TypedJobHandler<T>,
  ): void;
  requireEntry(typeId: string): JobRegistryEntry;
  has(typeId: string): boolean;
  knowsType(typeId: string): boolean;
  /** Fail-fast for enqueue: unknown type or missing handler. */
  assertReady(typeId: string): void;
  assertAllRegistered(): void;
  parsePayload(typeId: string, raw: unknown): unknown;
}

/** Binds catalog type defs to handlers (#629). */
export function createJobRegistry(
  catalog: readonly JobTypeDef[],
): JobRegistry {
  const byId = new Map<string, JobTypeDef>();
  for (const def of catalog) {
    if (byId.has(def.id)) {
      throw new Error(`duplicate job type in catalog: ${def.id}`);
    }
    byId.set(def.id, def);
  }

  const handlers = new Map<string, JobHandler>();

  return {
    register(type, handler) {
      if (!byId.has(type.id) || byId.get(type.id) !== type) {
        throw new Error(`job type not in catalog: ${type.id}`);
      }
      if (handlers.has(type.id)) {
        throw new Error(`job handler already registered: ${type.id}`);
      }
      // Runner validates via parsePayload before invoke; store as JobHandler.
      handlers.set(type.id, handler as JobHandler);
    },

    has(typeId) {
      return handlers.has(typeId);
    },

    knowsType(typeId) {
      return byId.has(typeId);
    },

    assertReady(typeId) {
      if (!byId.has(typeId)) {
        throw new Error(`unknown job type: ${typeId}`);
      }
      if (!handlers.has(typeId)) {
        throw new Error(`no handler registered for job type: ${typeId}`);
      }
    },

    assertAllRegistered() {
      for (const id of byId.keys()) {
        if (!handlers.has(id)) {
          throw new Error(`no handler registered for job type: ${id}`);
        }
      }
    },

    requireEntry(typeId) {
      const type = byId.get(typeId);
      const handler = handlers.get(typeId);
      if (!type || !handler) {
        throw new Error(`no handler registered for job type: ${typeId}`);
      }
      return { type, handler };
    },

    parsePayload(typeId, raw) {
      const type = byId.get(typeId);
      if (!type) {
        throw new Error(`unknown job type: ${typeId}`);
      }
      return type.payload.parse(raw);
    },
  };
}
