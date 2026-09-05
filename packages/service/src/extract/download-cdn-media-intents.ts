/**
 * Bounded parallel CDN downloads for extract media intents (#960).
 * Results stay in intent-index order even if downloads finish out of order.
 */

import type { AttachMediaFileInput } from "@collector/api";
import {
  DISK_ITEM_READ_CONCURRENCY,
  runWithConcurrency,
} from "@collector/core";

export async function downloadCdnMediaIntents(
  intents: readonly { sourceUrl: string; filename: string }[],
  download: (sourceUrl: string) => Promise<Uint8Array>,
): Promise<AttachMediaFileInput[]> {
  const downloaded = await runWithConcurrency(
    intents.length,
    DISK_ITEM_READ_CONCURRENCY,
    (index) => download(intents[index]!.sourceUrl),
  );
  return intents.map((intent, index) => ({
    name: intent.filename,
    bytes: downloaded[index]!,
  }));
}
