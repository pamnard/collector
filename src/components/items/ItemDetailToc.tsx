import { CornerDownRight } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import type { ArticleTocItem } from "../../lib/markdown/article-toc";
import { ItemDetailAsideSection } from "./ItemDetailAsideSection";

type ItemDetailTocProps = {
  items: ArticleTocItem[];
};

export function ItemDetailToc({ items }: ItemDetailTocProps) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");
  const scrollRoot = useMainScrollElement();

  useEffect(() => {
    setActiveId(items[0]?.id ?? "");
  }, [items]);

  useEffect(() => {
    if (items.length === 0) {
      return;
    }

    const itemIds = items.map((item) => item.id);
    const visible = new Set<string>();
    const onHashChange = () => {
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (hash !== "" && itemIds.includes(hash)) {
        setActiveId(hash);
      }
    };

    onHashChange();
    window.addEventListener("hashchange", onHashChange);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) {
            visible.add(id);
          } else {
            visible.delete(id);
          }
        }
        for (const id of itemIds) {
          if (visible.has(id)) {
            setActiveId(id);
            break;
          }
        }
      },
      {
        root: scrollRoot,
        rootMargin: "-15% 0px -70% 0px",
        threshold: [0, 1],
      },
    );

    for (const id of itemIds) {
      const el = document.getElementById(id);
      if (el) {
        observer.observe(el);
      }
    }

    return () => {
      window.removeEventListener("hashchange", onHashChange);
      observer.disconnect();
    };
  }, [items, scrollRoot]);

  if (items.length === 0) {
    return null;
  }

  const onNavClick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    const el = document.getElementById(id);
    if (!el) {
      console.error("[ItemDetailToc] heading element missing", { id });
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setActiveId(id);
  };

  return (
    <ItemDetailAsideSection title="Оглавление">
      <nav aria-label="Оглавление">
        <ul className="grid gap-2.5 text-sm">
          {items.map((item) => {
            const isSub = item.level === 3;
            const isActive = activeId === item.id;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={(event) => onNavClick(event, item.id)}
                  aria-current={isActive ? "location" : undefined}
                  className={cn(
                    "text-neutral-600 no-underline hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100",
                    isSub && "flex items-start gap-2",
                    !isSub && "block",
                    isActive &&
                      "font-semibold text-neutral-900 dark:text-neutral-100",
                  )}
                >
                  {isSub ? (
                    <>
                      <CornerDownRight
                        size={16}
                        className="mt-0.5 shrink-0 opacity-40"
                        aria-hidden
                      />
                      <span className="min-w-0">{item.text}</span>
                    </>
                  ) : (
                    item.text
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </ItemDetailAsideSection>
  );
}
