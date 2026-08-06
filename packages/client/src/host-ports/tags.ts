import type {
  ServiceSubscribeHandlers,
  Subscription,
  TagWithCount,
  TagsPort,
} from "@collector/api";
import {
  asCollectorApiError,
  subscriptionFromTeardown,
} from "@collector/api";
import type { Tag } from "@collector/shared";
import type { HostSessionCtx } from "../host-session-ctx.js";

export function createHostTagsPort(ctx: HostSessionCtx): TagsPort {
  const { transport } = ctx;
  return {
    subscribeTags(
      onUpdate: (tags: TagWithCount[]) => void,
      handlers?: ServiceSubscribeHandlers,
      signal?: AbortSignal,
    ): Subscription {
      const controller = new AbortController();
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener("abort", () => controller.abort(), {
            once: true,
          });
        }
      }
      const active = controller.signal;
      void (async () => {
        try {
          if (active.aborted) {
            return;
          }
          onUpdate((await transport.request("listTags")) as TagWithCount[]);
        } catch (error: unknown) {
          if (!active.aborted) {
            handlers?.onError?.("tags", asCollectorApiError(error));
          }
        }
      })();
      return subscriptionFromTeardown(() => controller.abort());
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
