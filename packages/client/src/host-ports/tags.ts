import type {
  ServiceSubscribeHandlers,
  Subscription,
  TagWithCount,
  TagsPort,
} from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";
import type { HostSessionCtx } from "../host-session-ctx.js";
import {
  voidSubscribePublishResult,
  withAbortBridge,
} from "./subscribe-helpers.js";

export function createHostTagsPort(ctx: HostSessionCtx): TagsPort {
  const { transport } = ctx;
  return {
    subscribeTags(
      onUpdate: (tags: TagWithCount[]) => void,
      handlers?: ServiceSubscribeHandlers,
      signal?: AbortSignal,
    ): Subscription {
      const { signal: active, dispose } = withAbortBridge(signal);
      voidSubscribePublishResult(
        active,
        () => transport.request("listTags") as Promise<TagWithCount[]>,
        onUpdate,
        handlers,
        "tags",
      );
      return subscriptionFromTeardown(dispose);
    },
    listTags: async (): Promise<TagWithCount[]> =>
      transport.request("listTags") as Promise<TagWithCount[]>,
  };
}
