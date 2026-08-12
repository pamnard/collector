import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils";

function classNameOf(
  className: ComponentPropsWithoutRef<"span">["className"],
): string {
  if (typeof className === "string") {
    return className;
  }
  if (Array.isArray(className)) {
    return className.filter(Boolean).join(" ");
  }
  return "";
}

/** Center block KaTeX outside typography quirks (#463). */
export function MarkdownSpan({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  const cls = classNameOf(className);
  if (cls.split(/\s+/).includes("katex-display")) {
    return (
      <div className="not-prose my-6 flex w-full justify-center overflow-x-auto px-2 py-2">
        <span className={cn(cls, "text-[1.21em]")} {...props}>
          {children}
        </span>
      </div>
    );
  }
  return (
    <span className={className} {...props}>
      {children}
    </span>
  );
}
