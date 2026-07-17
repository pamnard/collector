import type { ComponentProps } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof Group>) {
  return <Group className={cx("flex h-full w-full", className)} {...props} />;
}

export const ResizablePanel = Panel;

/**
 * In a horizontal Group the separator has aria-orientation="vertical"
 * (a vertical split line). Do NOT map that to w-full — that collapses panels.
 */
export function ResizableHandle({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cx(
        "relative z-10 shrink-0 bg-transparent transition-colors",
        // Vertical line (horizontal group) — default
        "w-px self-stretch",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-1.5 after:-translate-x-1/2",
        // Horizontal line (vertical group)
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:self-auto",
        "aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2",
        "aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1.5",
        "aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:-translate-y-1/2",
        "aria-[orientation=horizontal]:after:translate-x-0",
        "hover:bg-border data-[separator=active]:bg-border data-[separator=focus]:bg-border",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500",
        className,
      )}
      {...props}
    />
  );
}
