import type { ReactNode } from "react";

interface MainScrollAreaProps {
  children: ReactNode;
  contentInsetClass: string;
}

export function MainScrollArea({
  children,
  contentInsetClass,
}: MainScrollAreaProps) {
  return (
    <div className="main-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className={contentInsetClass}>{children}</div>
    </div>
  );
}
