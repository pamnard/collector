import { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { AdjacentItemRef, AdjacentItemsResult } from "@collector/api";

type ItemAdjacentNavProps = {
  adjacent: AdjacentItemsResult | null;
  onNavigate: (itemId: string) => void;
};

function AdjacentLink({
  side,
  item,
  onNavigate,
}: {
  side: "prev" | "next";
  item: AdjacentItemRef;
  onNavigate: (itemId: string) => void;
}) {
  const label = side === "prev" ? "Назад" : "Вперёд";
  const isPrev = side === "prev";
  const textRef = useRef<HTMLSpanElement>(null);
  const [squarePx, setSquarePx] = useState(0);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) {
      return;
    }
    const sync = () => {
      setSquarePx(Math.round(el.getBoundingClientRect().height));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [item.title, label]);

  const Arrow = isPrev ? ArrowLeft : ArrowRight;

  return (
    <button
      type="button"
      className={`flex min-w-0 flex-1 cursor-pointer items-center gap-3 ${
        isPrev ? "text-left" : "flex-row-reverse text-right"
      }`}
      onClick={() => onNavigate(item.id)}
    >
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        style={
          squarePx > 0
            ? { width: squarePx, height: squarePx }
            : { width: "2.5rem", height: "2.5rem" }
        }
        aria-hidden
      >
        <Arrow className="size-5" strokeWidth={2} />
      </span>
      <span ref={textRef} className="min-w-0 flex-1">
        <div className="truncate text-sm leading-5 font-medium">{item.title}</div>
        <div className="text-xs leading-4 text-neutral-500 dark:text-neutral-400">
          {label}
        </div>
      </span>
    </button>
  );
}

export function ItemAdjacentNav({ adjacent, onNavigate }: ItemAdjacentNavProps) {
  if (!adjacent || (!adjacent.prev && !adjacent.next)) {
    return null;
  }

  return (
    <nav
      aria-label="Соседние элементы в папке"
      className="flex items-center gap-4"
    >
      {adjacent.prev ? (
        <AdjacentLink side="prev" item={adjacent.prev} onNavigate={onNavigate} />
      ) : (
        <div className="flex-1" />
      )}
      {adjacent.next ? (
        <AdjacentLink side="next" item={adjacent.next} onNavigate={onNavigate} />
      ) : (
        <div className="flex-1" />
      )}
    </nav>
  );
}
