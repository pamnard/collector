/**
 * One-shot auto extract after note body write.
 * Discover → skip marked shortcodes → extract → mark metadata; fail → AlertStack.
 */

import type {
  ExtractPort,
  GetItemResult,
  UpdateItemInput,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  itemExtractAutoIdempotencyKey,
  itemExtractAutoJobType,
  type ItemExtractAutoJobPayload,
} from "@collector/shared";
import {
  extractAutoShortcode,
  filterUntriedExtractCandidates,
  mergeExtractAutoAttempt,
} from "../../extract/extract-auto-metadata.js";
import {
  notifyJobPermanentFailure,
  type JobPermanentFailureStore,
} from "../../job-permanent-failure.js";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

export type ItemExtractAutoEnqueueInput = ItemExtractAutoJobPayload;

export type ItemExtractAutoHandlerDeps = {
  getItemById: (itemId: string) => Promise<GetItemResult>;
  updateItem: (itemId: string, input: UpdateItemInput) => Promise<ItemFile>;
  discoverExtractCandidates: ExtractPort["discoverExtractCandidates"];
  extractItemCandidate: ExtractPort["extractItemCandidate"];
  jobPermanentFailure: JobPermanentFailureStore;
};

function reportShortcodeFailure(
  store: JobPermanentFailureStore,
  jobId: string,
  itemId: string,
  shortcode: string,
  candidateUrl: string,
  error: string,
): void {
  notifyJobPermanentFailure(store, {
    id: `${jobId}:${shortcode}:${crypto.randomUUID()}`,
    type: itemExtractAutoJobType.id,
    error: `Автоимпорт не удался для заметки ${itemId} (${shortcode}, ${candidateUrl}): ${error}`,
    attempts: 1,
  });
}

export function createItemExtractAutoHandler(
  deps: ItemExtractAutoHandlerDeps,
): TypedJobHandler<typeof itemExtractAutoJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    const { itemId } = job.payload;
    const candidates = await deps.discoverExtractCandidates(itemId);
    if (candidates.length === 0) {
      return { status: "ok" };
    }

    const { item } = await deps.getItemById(itemId);
    const pending = filterUntriedExtractCandidates(candidates, item.metadata);
    if (pending.length === 0) {
      return { status: "ok" };
    }

    let metadata = item.metadata ?? {};
    for (const candidate of pending) {
      const shortcode = extractAutoShortcode(candidate);
      if (!shortcode) {
        throw new Error(
          `itemExtractAuto: untried candidate missing shortcode: ${candidate.url}`,
        );
      }
      const attempted_at = new Date().toISOString();
      try {
        await deps.extractItemCandidate(itemId, candidate);
        metadata = mergeExtractAutoAttempt(metadata, shortcode, {
          attempted_at,
          ok: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        metadata = mergeExtractAutoAttempt(metadata, shortcode, {
          attempted_at,
          ok: false,
          error: message,
        });
        reportShortcodeFailure(
          deps.jobPermanentFailure,
          job.id,
          itemId,
          shortcode,
          candidate.url,
          message,
        );
      }
      await deps.updateItem(itemId, { metadata });
    }

    return { status: "ok" };
  };
}

export function enqueueItemExtractAuto(
  queue: JobQueue,
  payload: ItemExtractAutoJobPayload,
): Promise<EnqueueResult> {
  return queue.enqueue({
    type: itemExtractAutoJobType.id,
    payload,
    idempotencyKey: itemExtractAutoIdempotencyKey(payload),
  });
}
