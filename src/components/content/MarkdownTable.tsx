import type { ComponentPropsWithoutRef } from "react";

type MarkdownTableProps = ComponentPropsWithoutRef<"table"> & {
  node?: unknown;
};

/** GFM tables can be wider than the reading column — scroll inside, don't spill. */
export function MarkdownTable({ node: _node, ...props }: MarkdownTableProps) {
  return (
    <div className="custom-scrollbar relative w-full max-w-full min-w-0 overflow-x-auto">
      <table {...props} />
    </div>
  );
}
