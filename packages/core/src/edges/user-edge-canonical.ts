export type CanonicalUserEdgePair = {
  fromId: string;
  toId: string;
};

/** Undirected user edge: one row with lexicographically ordered endpoints (#407). */
export function canonicalUserEdgePair(
  itemA: string,
  itemB: string,
): CanonicalUserEdgePair {
  if (itemA === itemB) {
    throw new Error("user edge endpoints must differ");
  }
  return itemA < itemB
    ? { fromId: itemA, toId: itemB }
    : { fromId: itemB, toId: itemA };
}
