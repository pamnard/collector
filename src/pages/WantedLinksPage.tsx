import { Fragment, useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  CornerDownRight,
  FileText,
  Link2Off,
} from "lucide-react";
import type {
  BrokenOutgoingSourceRow,
  WantedLinkResolveStatus,
  WantedLinkSourceRow,
  WantedLinkTargetRow,
} from "@collector/api";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../components/alerts/AlertBusProvider";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { getCollectorService } from "../services/collector-client";
import { errorMessage } from "../services/runtime-error";
import { cn } from "../lib/utils";

const WANTED_LINKS_ERROR_ID = "wanted-links-error";
const BROKEN_OUTGOING_ERROR_ID = "broken-outgoing-links-error";
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const SOURCES_PAGE_SIZE = 100;

const TABLE_HEADER_CLASS =
  "bg-neutral-100/30 dark:bg-neutral-700/30 text-neutral-500 dark:text-neutral-400 [&_tr]:border-black/10 dark:[&_tr]:border-white/10";
const TABLE_ROW_CLASS =
  "border-black/10 dark:border-white/10 hover:bg-neutral-100/20 dark:hover:bg-neutral-700/20";

type LinksReportTab = "wanted" | "broken";

type ExpandedKey = string;

type SourcesEntry =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; rows: WantedLinkSourceRow[]; total: number }
  | { kind: "loading-more"; rows: WantedLinkSourceRow[]; total: number };

function targetKey(
  rawTarget: string,
  resolveStatus: WantedLinkResolveStatus,
): ExpandedKey {
  return `${resolveStatus}\0${rawTarget}`;
}

function parseLinksReportTab(raw: string | null): LinksReportTab {
  return raw === "broken" ? "broken" : "wanted";
}

function PaginationBar({
  total,
  pageIndex,
  pageSize,
  loading,
  onPageSize,
  onPageIndex,
}: {
  total: number;
  pageIndex: number;
  pageSize: number;
  loading: boolean;
  onPageSize: (size: (typeof PAGE_SIZE_OPTIONS)[number]) => void;
  onPageIndex: (updater: number | ((i: number) => number)) => void;
}) {
  if (total <= 0) {
    return null;
  }
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = pageIndex > 0;
  const canNext = (pageIndex + 1) * pageSize < total;
  return (
    <div className="flex items-center justify-between px-2">
      <div className="flex-1 text-sm text-neutral-500 dark:text-neutral-400">
        {pageIndex * pageSize + 1}–
        {Math.min((pageIndex + 1) * pageSize, total)} из {total}
      </div>
      <div className="flex items-center space-x-6 lg:space-x-8">
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium">На странице</p>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              onPageSize(Number(value) as (typeof PAGE_SIZE_OPTIONS)[number]);
              onPageIndex(0);
            }}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue placeholder={String(pageSize)} />
            </SelectTrigger>
            <SelectContent side="top">
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-[100px] items-center justify-center text-sm font-medium">
          Стр. {pageIndex + 1} из {pageCount}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => onPageIndex(0)}
            disabled={!canPrev || loading}
            aria-label="На первую страницу"
          >
            <ChevronsLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => onPageIndex((i) => Math.max(0, i - 1))}
            disabled={!canPrev || loading}
            aria-label="На предыдущую страницу"
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => onPageIndex((i) => i + 1)}
            disabled={!canNext || loading}
            aria-label="На следующую страницу"
          >
            <ChevronRight />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => onPageIndex(pageCount - 1)}
            disabled={!canNext || loading}
            aria-label="На последнюю страницу"
          >
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function WantedTargetsTab() {
  const navigate = useNavigate();
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([WANTED_LINKS_ERROR_ID]);

  const [pageSize, setPageSize] =
    useState<(typeof PAGE_SIZE_OPTIONS)[number]>(50);
  const [pageIndex, setPageIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<WantedLinkTargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [parentsFailed, setParentsFailed] = useState(false);
  const [expanded, setExpanded] = useState<Set<ExpandedKey>>(new Set());
  const [sourcesByKey, setSourcesByKey] = useState<
    Record<ExpandedKey, SourcesEntry>
  >({});

  const loadParents = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCollectorService().items.queryWantedLinkTargets(
        { limit: pageSize, offset: pageIndex * pageSize },
        { key: "source_count", dir: "desc" },
      );
      setTotal(result.total);
      setRows(result.rows);
      setParentsFailed(false);
      alerts.dismiss(WANTED_LINKS_ERROR_ID);
    } catch (error) {
      setParentsFailed(true);
      setTotal(0);
      setRows([]);
      alerts.upsert(WANTED_LINKS_ERROR_ID, {
        tone: "danger",
        message: "Не удалось загрузить битые ссылки",
        detail: errorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }, [alerts, pageIndex, pageSize]);

  useEffect(() => {
    void loadParents();
  }, [loadParents]);

  const fetchSources = async (
    row: WantedLinkTargetRow,
    key: ExpandedKey,
    offset: number,
    append: boolean,
  ) => {
    setSourcesByKey((prev) => {
      const existing = prev[key];
      if (
        append &&
        (existing?.kind === "ready" || existing?.kind === "loading-more")
      ) {
        return {
          ...prev,
          [key]: {
            kind: "loading-more",
            rows: existing.rows,
            total: existing.total,
          },
        };
      }
      return { ...prev, [key]: { kind: "loading" } };
    });
    try {
      const result =
        await getCollectorService().items.listWantedLinkTargetSources(
          {
            rawTarget: row.rawTarget,
            resolveStatus: row.resolveStatus,
          },
          { limit: SOURCES_PAGE_SIZE, offset },
        );
      setSourcesByKey((prev) => {
        const existing = prev[key];
        const priorRows =
          append &&
          (existing?.kind === "ready" || existing?.kind === "loading-more")
            ? existing.rows
            : [];
        return {
          ...prev,
          [key]: {
            kind: "ready",
            rows: [...priorRows, ...result.rows],
            total: result.total,
          },
        };
      });
    } catch (error) {
      setSourcesByKey((prev) => ({ ...prev, [key]: { kind: "error" } }));
      alerts.upsert(WANTED_LINKS_ERROR_ID, {
        tone: "danger",
        message: "Не удалось загрузить источники",
        detail: errorMessage(error),
      });
    }
  };

  const toggleExpand = async (row: WantedLinkTargetRow) => {
    const key = targetKey(row.rawTarget, row.resolveStatus);
    const willExpand = !expanded.has(key);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (willExpand) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });

    if (!willExpand) {
      return;
    }

    const existing = sourcesByKey[key];
    if (
      existing?.kind === "ready" ||
      existing?.kind === "loading" ||
      existing?.kind === "loading-more"
    ) {
      return;
    }

    await fetchSources(row, key, 0, false);
  };

  const copyTarget = async (rawTarget: string) => {
    try {
      await navigator.clipboard.writeText(rawTarget);
    } catch (error) {
      alerts.upsert(WANTED_LINKS_ERROR_ID, {
        tone: "danger",
        message: "Не удалось скопировать",
        detail: errorMessage(error),
      });
    }
  };

  const showEmpty = !loading && !parentsFailed && total === 0;

  if (showEmpty) {
    return (
      <Empty
        className="min-h-[min(28rem,60vh)] border border-dashed border-black/10 dark:border-white/10"
        data-testid="wanted-links-empty"
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Link2Off aria-hidden />
          </EmptyMedia>
          <EmptyTitle>Битых ссылок нет</EmptyTitle>
          <EmptyDescription>
            Все внутренние ссылки в хранилище ведут на существующие заметки.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Внутренние ссылки, цели которых нет в хранилище. Разверни строку —
        увидишь, откуда они ведут.
      </p>

      <div className="rounded-lg border border-black/10 dark:border-white/10">
          <Table className="table-fixed">
            <TableHeader className={TABLE_HEADER_CLASS}>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 px-2" />
                <TableHead className="px-3">Цель</TableHead>
                <TableHead className="w-28 px-3 text-right">Источники</TableHead>
                <TableHead className="w-12 px-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const key = targetKey(row.rawTarget, row.resolveStatus);
                const isOpen = expanded.has(key);
                const sources = sourcesByKey[key];
                return (
                  <Fragment key={key}>
                    <TableRow className={TABLE_ROW_CLASS}>
                      <TableCell className="px-2 pr-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-expanded={isOpen}
                          aria-label={
                            isOpen
                              ? "Свернуть источники"
                              : "Развернуть источники"
                          }
                          onClick={() => void toggleExpand(row)}
                        >
                          {isOpen ? (
                            <ChevronDown size={16} />
                          ) : (
                            <ChevronRight size={16} />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="overflow-hidden px-3 py-2 font-medium whitespace-normal">
                        {row.rawTarget}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">
                        {row.sourceCount}
                      </TableCell>
                      <TableCell className="px-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label="Копировать цель"
                          title="Копировать цель"
                          onClick={() => void copyTarget(row.rawTarget)}
                        >
                          <Copy size={16} />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      sources?.kind === "loading" ? (
                        <TableRow className={TABLE_ROW_CLASS}>
                          <TableCell />
                          <TableCell
                            colSpan={3}
                            className="px-3 py-2 text-neutral-500 dark:text-neutral-400"
                          >
                            Загрузка источников…
                          </TableCell>
                        </TableRow>
                      ) : sources?.kind === "error" ? (
                        <TableRow className={TABLE_ROW_CLASS}>
                          <TableCell />
                          <TableCell
                            colSpan={3}
                            className="px-3 py-2 text-neutral-500 dark:text-neutral-400"
                          >
                            <span className="inline-flex flex-wrap items-center gap-2">
                              Не удалось загрузить источники.
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  void fetchSources(row, key, 0, false)
                                }
                              >
                                Повторить
                              </Button>
                            </span>
                          </TableCell>
                        </TableRow>
                      ) : sources?.kind === "ready" ||
                        sources?.kind === "loading-more" ? (
                        <>
                          {sources.rows.map((source) => (
                            <TableRow
                              key={`${key}-${source.itemId}`}
                              className={cn(TABLE_ROW_CLASS, "cursor-pointer")}
                              onClick={() =>
                                navigate(`/item/${source.itemId}`)
                              }
                            >
                              <TableCell />
                              <TableCell
                                colSpan={3}
                                className="overflow-hidden px-3 py-2 whitespace-normal"
                              >
                                <span className="inline-flex items-center gap-2 pl-2 text-neutral-800 dark:text-neutral-200">
                                  <CornerDownRight
                                    size={16}
                                    className="shrink-0 text-neutral-400"
                                    aria-hidden
                                  />
                                  <span className="font-medium">
                                    {source.title}
                                  </span>
                                  {source.folderPath ? (
                                    <span className="text-neutral-500 dark:text-neutral-400">
                                      {source.folderPath}
                                    </span>
                                  ) : null}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                          {sources.rows.length < sources.total ? (
                            <TableRow className={TABLE_ROW_CLASS}>
                              <TableCell />
                              <TableCell
                                colSpan={3}
                                className="px-3 py-2 text-neutral-500 dark:text-neutral-400"
                              >
                                <span className="inline-flex flex-wrap items-center gap-2 pl-2">
                                  Показано {sources.rows.length} из{" "}
                                  {sources.total}
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={sources.kind === "loading-more"}
                                    onClick={() =>
                                      void fetchSources(
                                        row,
                                        key,
                                        sources.rows.length,
                                        true,
                                      )
                                    }
                                  >
                                    {sources.kind === "loading-more"
                                      ? "Загрузка…"
                                      : "Показать ещё"}
                                  </Button>
                                </span>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </>
                      ) : null
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>

      <PaginationBar
        total={total}
        pageIndex={pageIndex}
        pageSize={pageSize}
        loading={loading}
        onPageSize={setPageSize}
        onPageIndex={setPageIndex}
      />
    </div>
  );
}

function BrokenSourcesTab() {
  const navigate = useNavigate();
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([BROKEN_OUTGOING_ERROR_ID]);

  const [pageSize, setPageSize] =
    useState<(typeof PAGE_SIZE_OPTIONS)[number]>(50);
  const [pageIndex, setPageIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<BrokenOutgoingSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [parentsFailed, setParentsFailed] = useState(false);

  const loadParents = useCallback(async () => {
    setLoading(true);
    try {
      const result =
        await getCollectorService().items.queryBrokenOutgoingLinkSources(
          { limit: pageSize, offset: pageIndex * pageSize },
          { key: "broken_count", dir: "desc" },
        );
      setTotal(result.total);
      setRows(result.rows);
      setParentsFailed(false);
      alerts.dismiss(BROKEN_OUTGOING_ERROR_ID);
    } catch (error) {
      setParentsFailed(true);
      setTotal(0);
      setRows([]);
      alerts.upsert(BROKEN_OUTGOING_ERROR_ID, {
        tone: "danger",
        message: "Не удалось загрузить страницы с битыми ссылками",
        detail: errorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }, [alerts, pageIndex, pageSize]);

  useEffect(() => {
    void loadParents();
  }, [loadParents]);

  const showEmpty = !loading && !parentsFailed && total === 0;

  if (showEmpty) {
    return (
      <Empty
        className="min-h-[min(28rem,60vh)] border border-dashed border-black/10 dark:border-white/10"
        data-testid="broken-outgoing-empty"
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Link2Off aria-hidden />
          </EmptyMedia>
          <EmptyTitle>Нет заметок с битыми исходящими</EmptyTitle>
          <EmptyDescription>
            У всех заметок исходящие внутренние ссылки ведут на существующие
            цели.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Заметки, у которых есть хотя бы одна битая исходящая внутренняя ссылка.
        Кликни строку — откроется заметка.
      </p>

      <div className="rounded-lg border border-black/10 dark:border-white/10">
          <Table className="table-fixed">
            <TableHeader className={TABLE_HEADER_CLASS}>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 px-2" />
                <TableHead className="px-3">Заметка</TableHead>
                <TableHead className="w-28 px-3 text-right">Битые</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.itemId}
                  className={cn(TABLE_ROW_CLASS, "cursor-pointer")}
                  data-testid="broken-outgoing-row"
                  onClick={() => navigate(`/item/${row.itemId}`)}
                >
                  <TableCell className="px-2 pr-0">
                    <span className="inline-flex size-8 items-center justify-center text-neutral-400 dark:text-neutral-500">
                      <FileText size={16} aria-hidden />
                    </span>
                  </TableCell>
                  <TableCell className="overflow-hidden px-3 py-2 whitespace-normal">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="font-medium">{row.title}</span>
                      {row.folderPath ? (
                        <span className="text-neutral-500 dark:text-neutral-400">
                          {row.folderPath}
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">
                    {row.brokenCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

      <PaginationBar
        total={total}
        pageIndex={pageIndex}
        pageSize={pageSize}
        loading={loading}
        onPageSize={setPageSize}
        onPageIndex={setPageIndex}
      />
    </div>
  );
}

export function WantedLinksPage() {
  const [searchParams] = useSearchParams();
  const tab = parseLinksReportTab(searchParams.get("tab"));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 pb-4 md:pb-8">
      {tab === "broken" ? <BrokenSourcesTab /> : <WantedTargetsTab />}
    </div>
  );
}
