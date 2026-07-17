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

export function ResizableHandle({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cx(
        "relative flex w-px shrink-0 items-center justify-center bg-transparent transition-colors",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-1.5 after:-translate-x-1/2",
        "hover:bg-border data-[separator=active]:bg-border data-[separator=focus]:bg-border",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500",
        "aria-[orientation=vertical]:h-px aria-[orientation=vertical]:w-full",
        "aria-[orientation=vertical]:after:left-0 aria-[orientation=vertical]:after:h-1.5",
        "aria-[orientation=vertical]:after:w-full aria-[orientation=vertical]:after:-translate-y-1/2",
        "aria-[orientation=vertical]:after:translate-x-0",
        className,
      )}
      {...props}
    />
  );
}
