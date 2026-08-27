import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import type { ItemFile } from "@collector/shared";
import type { DashboardItemSort, ItemThumbnailPixelSize } from "@collector/api";
import type { DashboardListSnapshot } from "../../lib/dashboard-commit";
import type { DashboardQueryCacheEntry } from "../../services/dashboard-query-cache";
import type { NavFilter } from "../../types/ui";

export type StartCoverPathFlight = (
  requestVersion: number,
  orderedItems: ItemFile[],
  options?: { blockOnCovers?: boolean; deferUiCommit?: boolean },
) => Promise<void>;

export type DashboardListState = {
  itemIds: string[];
  itemsById: Map<string, ItemFile>;
  streamEndOffset: number;
  totalCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  committedItems: ItemFile[];
  committedThumbnailPaths: Map<string, string | null>;
  committedThumbnailStamps: Map<string, string>;
  committedThumbnailSizes: Map<string, ItemThumbnailPixelSize | null>;
  committedTotalCount: number;
  committedHasMore: boolean;
  workingItems: ItemFile[];
  requestVersionRef: MutableRefObject<number>;
  streamEndOffsetRef: MutableRefObject<number>;
  itemIdsRef: MutableRefObject<string[]>;
  itemsByIdRef: MutableRefObject<Map<string, ItemFile>>;
  bodyStampsRef: MutableRefObject<Map<string, string>>;
  committedBodyStampsRef: MutableRefObject<Map<string, string>>;
  totalCountRef: MutableRefObject<number>;
  committedItemsRef: MutableRefObject<ItemFile[]>;
  committedThumbnailPathsRef: MutableRefObject<Map<string, string | null>>;
  committedThumbnailStampsRef: MutableRefObject<Map<string, string>>;
  committedThumbnailSizesRef: MutableRefObject<
    Map<string, ItemThumbnailPixelSize | null>
  >;
  committedTotalCountRef: MutableRefObject<number>;
  queryKeyRef: MutableRefObject<string>;
  streamAbortRef: MutableRefObject<AbortController | null>;
  persistTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  queryBusyRef: MutableRefObject<boolean>;
  filterRef: MutableRefObject<NavFilter>;
  searchQueryRef: MutableRefObject<string>;
  sortRef: MutableRefObject<DashboardItemSort>;
  setItemIds: Dispatch<SetStateAction<string[]>>;
  setItemsById: Dispatch<SetStateAction<Map<string, ItemFile>>>;
  setStreamEndOffset: Dispatch<SetStateAction<number>>;
  setTotalCount: Dispatch<SetStateAction<number>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsLoadingMore: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setCommittedItems: Dispatch<SetStateAction<ItemFile[]>>;
  setCommittedThumbnailPaths: Dispatch<
    SetStateAction<Map<string, string | null>>
  >;
  setCommittedThumbnailStamps: Dispatch<SetStateAction<Map<string, string>>>;
  setCommittedThumbnailSizes: Dispatch<
    SetStateAction<Map<string, ItemThumbnailPixelSize | null>>
  >;
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
