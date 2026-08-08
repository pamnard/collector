import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ItemDetailAsideSectionProps = {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
};

export function ItemDetailAsideSection({
  title,
  children,
  className,
  defaultOpen = true,
}: ItemDetailAsideSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={cn("space-y-3", className)}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {title}
        </h2>
        <ChevronDown
          size={16}
          className={cn(
            "shrink-0 text-neutral-500 transition-transform dark:text-neutral-400",
            !open && "-rotate-90",
          )}
          aria-hidden
        />
      </button>
      {open ? children : null}
    </section>
  );
}
