import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { handleExternalLinkClick } from "../../utils/open-external-url";

type ExternalAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children?: ReactNode;
  node?: unknown;
};

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
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }
        handleExternalLinkClick(event, href, openUrl);
      }}
    >
      {children}
    </a>
  );
}