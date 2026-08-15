/** True when old/new id sets are not disjoint, or oldId/newId repeats in the list. */
export function mappingsHaveOverlappingIds(
  mappings: Array<{ oldId: string; newId: string }>,
): boolean {
  const oldIds = new Set<string>();
  const newIds = new Set<string>();
  for (const mapping of mappings) {
    if (oldIds.has(mapping.oldId) || newIds.has(mapping.newId)) {
      return true;
    }
    oldIds.add(mapping.oldId);
    newIds.add(mapping.newId);
  }
  for (const oldId of oldIds) {
    if (newIds.has(oldId)) {
      return true;
    }
  }
  return false;
}
