import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import type { ItemFile } from "@collector/shared";
import type { DashboardItemSort } from "@collector/api";
import type { DashboardListSnapshot } from "../../lib/dashboard-commit";
import type { CoverController } from "../../lib/cover-controller";
import type { DashboardQueryCacheEntry } from "../../services/dashboard-query-cache";
import type { NavFilter } from "../../types/ui";

export type StartCoverPathFlight = (
  requestVersion: number,
  orderedItems: ItemFile[],
  options?: { blockOnCovers?: boolean; deferUiCommit?: boolean },
) => Promise<void>;

/** Cover-flight adapter only needs the painted list window. */
export type CoverFlightListBindings = {
  committedItems: ItemFile[];
};

export type DashboardListState = CoverFlightListBindings & {
  itemIds: string[];
  itemsById: Map<string, ItemFile>;
  streamEndOffset: number;
  totalCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  committedTotalCount: number;
  committedHasMore: boolean;
  workingItems: ItemFile[];
  requestVersionRef: MutableRefObject<number>;
  queryKeyRef: MutableRefObject<string>;
  itemIdsRef: MutableRefObject<string[]>;
  itemsByIdRef: MutableRefObject<Map<string, ItemFile>>;
  bodyStampsRef: MutableRefObject<Map<string, string>>;
  streamEndOffsetRef: MutableRefObject<number>;
  totalCountRef: MutableRefObject<number>;
  committedBodyStampsRef: MutableRefObject<Map<string, string>>;
  committedItemsRef: MutableRefObject<ItemFile[]>;
  committedTotalCountRef: MutableRefObject<number>;
  streamAbortRef: MutableRefObject<AbortController | null>;
  persistTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  queryBusyRef: MutableRefObject<boolean>;
  filterRef: MutableRefObject<NavFilter>;
  searchQueryRef: MutableRefObject<string>;
  sortRef: MutableRefObject<DashboardItemSort>;
  covers: CoverController;
  setItemIds: Dispatch<SetStateAction<string[]>>;
  setItemsById: Dispatch<SetStateAction<Map<string, ItemFile>>>;
  setStreamEndOffset: Dispatch<SetStateAction<number>>;
  setTotalCount: Dispatch<SetStateAction<number>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsLoadingMore: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setCommittedItems: Dispatch<SetStateAction<ItemFile[]>>;
  setCommittedTotalCount: Dispatch<SetStateAction<number>>;
  setCommittedHasMore: Dispatch<SetStateAction<boolean>>;
  writeQueryCache: (
    ids: string[],
    byId: Map<string, ItemFile>,
    end: number,
    nextTotal: number,
  ) => void;
  applyListSnapshot: (snapshot: DashboardListSnapshot) => void;
  applyCacheEntryToState: (entry: DashboardQueryCacheEntry) => void;
  commitWorkingToDisplay: (
    requestVersion: number,
    options?: { blockOnCovers?: boolean },
  ) => Promise<void>;
  setStreamWindowEnd: (end: number) => void;
  setLoadedItemIds: (nextIds: string[]) => void;
  pruneItem: (itemId: string) => void;
  clearWorkingWindow: () => void;
  clearCommittedPaint: () => void;
};
