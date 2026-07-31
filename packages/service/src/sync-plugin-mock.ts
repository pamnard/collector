/**
 * In-memory mock SyncPlugin (#28) for contract tests / dry-runs.
 *
 * Queue semantics: pull returns pending items; ack removes them by remoteId
 * (retry-safe — ack of already-removed ids is a no-op). Cursor advances on
 * each successful pull that returns nextCursor; callers only persist that
 * when the full cycle succeeds (see runSyncPluginCycle).
 */

import type {
  NormalizedSyncItem,
  PullResult,
  SyncCursor,
  SyncPlugin,
} from "@collector/api";

export interface MockSyncPluginOptions {
  id?: string;
  /** Initial queue; also used by enqueue(). */
  items?: NormalizedSyncItem[];
}

export interface MockSyncPlugin extends SyncPlugin {
  enqueue(items: NormalizedSyncItem[]): void;
  pending(): NormalizedSyncItem[];
  authenticateCalls: number;
  pullCalls: number;
  ackCalls: string[][];
}

export function createMockSyncPlugin(
  options: MockSyncPluginOptions = {},
): MockSyncPlugin {
  const queue: NormalizedSyncItem[] = [...(options.items ?? [])];
  let pullCount = 0;

  const plugin: MockSyncPlugin = {
    id: options.id ?? "mock",
    authenticateCalls: 0,
    pullCalls: 0,
    ackCalls: [],

    enqueue(items: NormalizedSyncItem[]) {
      queue.push(...items);
    },

    pending() {
      return [...queue];
    },

    async authenticate() {
      plugin.authenticateCalls += 1;
    },

    async pull(cursor: SyncCursor | null): Promise<PullResult> {
      plugin.pullCalls += 1;
      pullCount += 1;
      const items = [...queue];
      const nextCursor: SyncCursor = `mock:${pullCount}:${cursor ?? "start"}`;
      return { items, nextCursor };
    },

    async ack(remoteIds: string[]) {
      plugin.ackCalls.push([...remoteIds]);
      const remove = new Set(remoteIds);
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (remove.has(queue[i].remoteId)) {
          queue.splice(i, 1);
        }
      }
    },
  };

  return plugin;
}
