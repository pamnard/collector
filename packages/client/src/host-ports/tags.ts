import type {
  ServiceSubscribeHandlers,
  Subscription,
  TagWithCount,
  TagsPort,
} from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";
import type { Tag } from "@collector/shared";
import type { HostSessionCtx } from "../host-session-ctx.js";
import { voidSubscribePublish, withAbortBridge } from "./subscribe-helpers.js";

export function createHostTagsPort(ctx: HostSessionCtx): TagsPort {
  const { transport } = ctx;
  return {
    subscribeTags(
      onUpdate: (tags: TagWithCount[]) => void,
      handlers?: ServiceSubscribeHandlers,
      signal?: AbortSignal,
    ): Subscription {
      const { signal: active, dispose } = withAbortBridge(signal);
      voidSubscribePublish(
        active,
        async () => {
          onUpdate((await transport.request("listTags")) as TagWithCount[]);
        },
        handlers,
        "tags",
      );
      return subscriptionFromTeardown(dispose);
    },
    listTags: async (): Promise<TagWithCount[]> =>
      transport.request("listTags") as Promise<TagWithCount[]>,
    createTag: async (input: {
      name: string;
      color?: string | null;
    }): Promise<Tag> =>
      transport.request(
        "createTag",
        input as unknown as Record<string, unknown>,
      ) as Promise<Tag>,
    updateTagRecord: async (
      tagId: string,
      input: { name?: string; color?: string | null },
    ): Promise<Tag> =>
      transport.request("updateTagRecord", {
        tagId,
        input,
      }) as Promise<Tag>,
    deleteTag: async (tagId: string): Promise<void> => {
      await transport.request("deleteTag", { tagId });
    },
  };
}
