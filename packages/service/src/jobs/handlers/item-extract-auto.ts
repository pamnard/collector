/**
 * One-shot auto extract after note body write.
 * Discover → skip marked shortcodes → extract → mark host store; fail → AlertStack.
 */

import type { ExtractPort } from "@collector/api";
import {
  itemExtractAutoIdempotencyKey,
  itemExtractAutoJobType,
  type ItemExtractAutoJobPayload,
} from "@collector/shared";
import type { ExtractAutoAttemptStore } from "../../extract/extract-auto-attempt-store.js";
import {
  extractAutoShortcode,
  filterUntriedExtractCandidates,
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
  discoverExtractCandidates: ExtractPort["discoverExtractCandidates"];
  extractItemCandidate: ExtractPort["extractItemCandidate"];
  extractAutoAttempts: ExtractAutoAttemptStore;
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
    const { vaultId, itemId } = job.payload;
    const candidates = await deps.discoverExtractCandidates(itemId);
    if (candidates.length === 0) {
      return { status: "ok" };
    }

    const tried = await deps.extractAutoAttempts.readItemAttempts(
      vaultId,
      itemId,
    );
    const pending = filterUntriedExtractCandidates(candidates, tried);
    if (pending.length === 0) {
      return { status: "ok" };
    }

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
        await deps.extractAutoAttempts.recordAttempt(vaultId, itemId, shortcode, {
          attempted_at,
          ok: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await deps.extractAutoAttempts.recordAttempt(vaultId, itemId, shortcode, {
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
