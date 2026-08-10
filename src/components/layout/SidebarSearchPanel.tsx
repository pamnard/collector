import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { sidebarSearchCacheKey } from "../../lib/sidebar-search-cache-key";
import { getCollectorService } from "../../services/collector-client";
import { Input } from "../ui/input";

interface SidebarSearchPanelProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  vaultRevision: number;
  searchIndexBuilding?: boolean;
}

export function SidebarSearchPanel({
  searchQuery,
  onSearchChange,
  vaultRevision,
  searchIndexBuilding = false,
}: SidebarSearchPanelProps) {
  const navigate = useNavigate();
  const debouncedQuery = useDebouncedValue(searchQuery, 300);
  const [results, setResults] = useState<ItemFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultsCacheKey = sidebarSearchCacheKey(
    debouncedQuery.trim(),
    vaultRevision,
  );

  useEffect(() => {
    const query = debouncedQuery.trim();
    if (!query) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    void getCollectorService().items
      .searchItems(query, "all")
      .then((items) => {
        if (controller.signal.aborted) {
          return;
        }
        setResults(items);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setResults([]);
        setIsLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      controller.abort();
    };
    // resultsCacheKey encodes query + vaultRevision (path ids change on move).
  }, [debouncedQuery, resultsCacheKey]);

  const placeholder = searchIndexBuilding
    ? "Поиск по названию… (индекс строится)"
    : "Поиск...";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 py-2">
        <div className="relative flex w-full items-center">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 text-neutral-500"
          />
          <Input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onSearchChange("");
              }
            }}
            placeholder={placeholder}
            title={
              searchIndexBuilding
                ? "Полнотекстовый поиск по содержимому ещё строится — ищем только по названию и описанию"
                : undefined
            }
            className="h-9 border-black/10 dark:border-white/10 bg-neutral-100/80 dark:bg-neutral-700/80 pl-9 pr-9 text-sm"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 rounded-lg p-1 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              title="Очистить"
              aria-label="Очистить поиск"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        {!debouncedQuery.trim() ? (
          <p className="px-4 py-3 text-sm text-neutral-500">
            Введите запрос для поиска
          </p>
        ) : null}
        {isLoading ? (
          <p className="px-4 py-3 text-sm text-neutral-500">Поиск…</p>
        ) : null}
        {error ? (
          <p className="px-4 py-3 text-sm text-red-400 whitespace-pre-wrap">
            {error}
          </p>
        ) : null}
        {!isLoading && !error && debouncedQuery.trim() && results.length === 0 ? (
          <p className="px-4 py-3 text-sm text-neutral-500">Ничего не найдено</p>
        ) : null}
        <ul className="divide-y divide-black/10 dark:divide-white/10">
          {results.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => navigate(`/item/${item.id}`)}
                className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left text-sm transition-colors hover:bg-neutral-100/65 dark:hover:bg-neutral-700/65"
              >
                <span className="line-clamp-2 font-medium text-neutral-900 dark:text-neutral-100">
                  {item.title}
                </span>
                {item.description ? (
                  <span className="line-clamp-2 text-neutral-500 dark:text-neutral-400">
                    {item.description}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
