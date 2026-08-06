import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { handleExternalLinkClick } from "../../utils/open-external-url";

type ExternalAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children?: ReactNode;
  node?: unknown;
};

async function openInBrowser(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ExternalAnchor({
  href,
  children,
  onClick,
  node: _node,
  ...props
}: ExternalAnchorProps) {
  return (
    <a
      {...props}
      href={href}
      target={props.target ?? "_blank"}
      rel={props.rel ?? "noopener noreferrer"}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }
        handleExternalLinkClick(event, href, openInBrowser);
      }}
    >
      {children}
    </a>
  );
}
