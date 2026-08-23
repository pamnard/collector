import { useLayoutEffect, useRef, type ReactNode } from "react";

interface MainScrollAreaProps {
  children: ReactNode;
  resetKey: string;
}

export function MainScrollArea({ children, resetKey }: MainScrollAreaProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    ref.current?.scrollTo(0, 0);
  }, [resetKey]);

  return (
    <div
      ref={ref}
      className="main-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
    >
      {children}
    </div>
  );
}
