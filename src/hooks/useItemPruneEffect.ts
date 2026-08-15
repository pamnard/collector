import { useEffect, useRef } from "react";

/** Broadcast that a vault item id must leave clickable UI lists before refetch. */
export type ItemPruneSignal = {
  itemId: string;
  seq: number;
};

export function nextItemPruneSignal(
  previous: ItemPruneSignal | null,
  itemId: string,
): ItemPruneSignal {
  return {
    itemId,
    seq: (previous?.seq ?? 0) + 1,
  };
}

/** Apply a shell prune broadcast without re-subscribing when the updater identity changes. */
export function useItemPruneEffect(
  signal: ItemPruneSignal | null,
  onPrune: (itemId: string) => void,
): void {
  const onPruneRef = useRef(onPrune);
  onPruneRef.current = onPrune;
  useEffect(() => {
    if (!signal) {
      return;
    }
    onPruneRef.current(signal.itemId);
  }, [signal]);
}
