import type { BacklinkSource } from "@collector/core";
import { buildBacklinkReverseMap } from "@collector/core";

type ReverseMap = Map<string, BacklinkSource[]>;

type CacheEntry = {
  generation: number;
  reverse: ReverseMap;
};

const cacheByVault = new Map<string, CacheEntry>();

/** Test helper: drop all in-memory reverse maps. */
export function clearBacklinkReverseCache(): void {
  cacheByVault.clear();
}

export async function getBacklinksForTarget(options: {
  vaultId: string;
  targetItemId: string;
  generation: number;
  loadBodies: () => Promise<
    Array<{ id: string; title: string; content: string }>
  >;
  loadCatalog: () => Promise<Array<{ id: string; title: string }>>;
  bodyFromContent: (content: string) => string;
}): Promise<BacklinkSource[]> {
  const cached = cacheByVault.get(options.vaultId);
  if (cached && cached.generation === options.generation) {
    return cached.reverse.get(options.targetItemId) ?? [];
  }

  const [catalog, rows] = await Promise.all([
    options.loadCatalog(),
    options.loadBodies(),
  ]);
  const sources = rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: options.bodyFromContent(row.content),
  }));
  const reverse = buildBacklinkReverseMap(catalog, sources);
  cacheByVault.set(options.vaultId, {
    generation: options.generation,
    reverse,
  });
  return reverse.get(options.targetItemId) ?? [];
}
