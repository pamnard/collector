import { createPortal } from "react-dom";
import type { ReactNode } from "react";

interface AlertStackProps {
  children: ReactNode;
}

/**
 * Bottom-right overlay host. Stacks children vertically (newest visually above older).
 * Insets match page content (`p-4` / `md:p-8`) plus main scrollbar width so the
 * right edge aligns with cards inside the scrollport (not the viewport chrome).
 */
export function AlertStack({ children }: AlertStackProps) {
  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 right-[calc(1rem+var(--main-scrollbar-width))] z-[100] flex max-w-sm flex-col-reverse gap-2 md:bottom-8 md:right-[calc(2rem+var(--main-scrollbar-width))]"
      aria-live="polite"
    >
      {children}
    </div>,
    document.body,
  );
}
