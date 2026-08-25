/**
 * Wire localizeRemoteDisplayAssets for the domain host (#739).
 */

import {
  localizeRemoteDisplayAssets,
  type VaultContext,
} from "@collector/core";
import {
  inferMediaType,
  type GeneratedCover,
  type MediaType,
} from "@collector/shared";
import { fetchRemoteBytes } from "./fetch-remote-bytes.js";
import { generateCoverFromMedia } from "./host/node-cover.js";

export type LocalizeItemRemoteDisplayAssets = (input: {
  itemId: string;
  rawMarkdown: string;
  itemUrl?: string | null;
}) => Promise<{ text: string; changed: boolean }>;

export function createLocalizeItemRemoteDisplayAssets(deps: {
  getContext: () => VaultContext;
  resolveActiveVault: () => Promise<{ vault: { id: string }; path: string }>;
  fetchBytes?: typeof fetchRemoteBytes;
  encodeCoverWebp?: (
    data: Uint8Array,
    filename: string,
    mediaType: MediaType,
  ) => Promise<GeneratedCover | null>;
}): LocalizeItemRemoteDisplayAssets {
  const fetchBytes = deps.fetchBytes ?? fetchRemoteBytes;
  const encodeCover = deps.encodeCoverWebp ?? generateCoverFromMedia;

  return async (input) => {
    const { vault, path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    return localizeRemoteDisplayAssets({
      ctx,
      vaultPath: path,
      vaultId: vault.id,
      itemId: input.itemId,
      rawMarkdown: input.rawMarkdown,
      itemUrl: input.itemUrl,
      fetchBytes,
      encodeCoverWebp: async (data, filename) => {
        const cover = await encodeCover(
          data,
          filename,
          inferMediaType(filename),
        );
        if (!cover) {
          throw new Error(
            `localizeRemoteDisplayAssets: encodeCoverWebp returned null for ${filename}`,
          );
        }
        return cover;
      },
    });
  };
}
