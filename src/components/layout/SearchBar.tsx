import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  /** True while Phase B (content FTS) is still building for the active vault. */
  searchIndexBuilding?: boolean;
}

export function SearchBar({
  searchQuery,
  onSearchChange,
  searchIndexBuilding = false,
}: SearchBarProps) {
  const [isOpen, setIsOpen] = useState(Boolean(searchQuery));
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchQuery) {
      setIsOpen(true);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        !searchQuery
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [searchQuery]);

  const expanded = isOpen || Boolean(searchQuery);
  const placeholder = searchIndexBuilding
    ? "Поиск по названию… (индекс строится)"
    : "Поиск...";

  return (
    <div
      ref={containerRef}
      className={`flex items-center bg-input/65 backdrop-blur-md border rounded-lg transition-all duration-300 ${
        expanded ? "border-border pr-1" : "border-transparent"
      }`}
    >
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        title={
          searchIndexBuilding
            ? "Полнотекстовый поиск по содержимому ещё строится — ищем только по названию и описанию"
            : undefined
        }
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onSearchChange("");
            setIsOpen(false);
          }
        }}
        className={`bg-transparent border-none outline-none text-primary text-sm placeholder-muted py-2 transition-all duration-200 ${
          expanded ? "w-60 opacity-100 pl-3" : "w-0 opacity-0 p-0"
        }`}
      />
      <button
        type="button"
        onClick={() => {
          if (searchQuery) {
            onSearchChange("");
            inputRef.current?.focus();
            return;
          }
          setIsOpen((current) => !current);
        }}
        className="p-2 text-secondary hover:text-primary transition-colors"
        title={searchQuery ? "Очистить" : "Поиск"}
      >
        {searchQuery ? <X size={20} /> : <Search size={20} />}
      </button>
    </div>
  );
}
