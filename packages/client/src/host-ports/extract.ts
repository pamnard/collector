import type { ExtractCandidate, ExtractPort } from "@collector/api";
import type { HostSessionCtx } from "../host-session-ctx.js";

export function createHostExtractPort(ctx: HostSessionCtx): ExtractPort {
  const { transport } = ctx;
  return {
    discoverExtractCandidates: async (itemId) =>
      transport.request("discoverExtractCandidates", {
        itemId,
      }) as Promise<ExtractCandidate[]>,
    extractItemCandidate: async (itemId, candidate) => {
      await transport.request("extractItemCandidate", { itemId, candidate });
    },
  };
}
