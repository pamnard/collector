import type { ReactNode } from "react";

interface MainScrollAreaProps {
  children: ReactNode;
}

export function MainScrollArea({ children }: MainScrollAreaProps) {
  return (
    <div className="main-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
      {children}
    </div>
  );
}
