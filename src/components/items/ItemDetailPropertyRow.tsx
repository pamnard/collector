import type { ReactNode } from "react";
import type { PropertyKind } from "../../lib/frontmatter-property-kind";
import { KIND_ICON } from "./item-detail-inline-editor-helpers";

export function ItemDetailPropertyRow({
  label,
  kind,
  children,
}: {
  label: string;
  kind: PropertyKind;
  children: ReactNode;
}) {
  const Icon = KIND_ICON[kind];
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex shrink-0 items-center gap-2 sm:w-40 sm:pt-2">
        <Icon className="size-4 text-neutral-500 dark:text-neutral-400" aria-hidden />
        <span className="text-sm font-medium truncate" title={label}>
          {label}
        </span>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
