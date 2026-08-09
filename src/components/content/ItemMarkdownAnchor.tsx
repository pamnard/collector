import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { decodeItemPathHref } from "@collector/core";
import { cn } from "../../lib/utils";
import { ExternalAnchor } from "./ExternalAnchor";
import { classifyItemMarkdownHref } from "./item-markdown-href";

type ItemMarkdownAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children?: ReactNode;
  node?: unknown;
};

/** Translucent bottom border instead of native underline (#434324e). */
const LINK_BORDER_CLASS =
  "!border-b !border-indigo-400/50 !no-underline";

/** Same border underline; redder text/border for missing targets. */
const UNRESOLVED_LINK_CLASS =
  "!border-b !border-red-400/60 !text-red-400 !no-underline dark:!border-red-400/50 dark:!text-red-400";

export function ItemMarkdownAnchor({
  href,
  children,
  onClick,
  className,
  node: _node,
  ...props
}: ItemMarkdownAnchorProps) {
  const navigate = useNavigate();
  const kind = classifyItemMarkdownHref(href);

  if (kind === "external") {
    return (
      <ExternalAnchor
        {...props}
        href={href}
        className={cn(LINK_BORDER_CLASS, className)}
        onClick={onClick}
      >
        {children}
      </ExternalAnchor>
    );
  }

  if (kind === "unresolved") {
    return (
      <a
        {...props}
        href={href}
        className={cn(UNRESOLVED_LINK_CLASS, className)}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          onClick?.(event);
          event.preventDefault();
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <a
      {...props}
      href={href}
      className={cn(LINK_BORDER_CLASS, className)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || !href) {
          return;
        }
        event.preventDefault();
        navigate(decodeItemPathHref(href));
      }}
    >
      {children}
    </a>
  );
}
