/**
 * Typed background job catalog (#629).
 *
 * How to add a new job type:
 * 1. `defineJobType({ id, payload })` here (Zod schema for the payload).
 * 2. Append the def to `JOB_TYPE_CATALOG` (sole production type-id list).
 * 3. In the host: `registry.register(thatType, handler)` — no runner/poll edits.
 * 4. Enqueue with `{ type: id, payload }` — unknown types and invalid payloads fail fast.
 */

import { z } from "zod";

export type JobTypeDef<T extends z.ZodTypeAny = z.ZodTypeAny> = {
  readonly id: string;
  readonly payload: T;
};

export function defineJobType<T extends z.ZodTypeAny>(def: {
  id: string;
  payload: T;
}): JobTypeDef<T> {
  if (!def.id) {
    throw new Error("job type id must be non-empty");
  }
  return { id: def.id, payload: def.payload };
}

export const testNoopJobPayloadSchema = z.object({
  fail: z.enum(["retryable", "permanent"]).optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
});

export type TestNoopJobPayload = z.infer<typeof testNoopJobPayloadSchema>;

export const testNoopJobType = defineJobType({
  id: "__test_noop",
  payload: testNoopJobPayloadSchema,
});

/**
 * Production catalog — the single explicit list of job type ids (#629).
 * Phase B types join here; test suites may pass a local catalog to
 * `createJobRegistry` without mutating this array.
 */
export const JOB_TYPE_CATALOG = [testNoopJobType] as const;

export type JobTypeId = (typeof JOB_TYPE_CATALOG)[number]["id"];
