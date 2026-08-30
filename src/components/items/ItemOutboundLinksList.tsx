import type { OutboundTextLink } from "@collector/api";
import { itemPathHref } from "@collector/core";
import { cn } from "@/lib/utils";
import { ExternalAnchor } from "../content/ExternalAnchor";
import {
  ITEM_MARKDOWN_LINK_BORDER_CLASS,
  UNRESOLVED_LINK_CLASS,
} from "../content/ItemMarkdownAnchor";
import {
  outboundLinkLabel,
  externalOutboundUrlHint,
  splitOutboundLinks,
} from "./item-outbound-links";

type ItemOutboundLinksListProps = {
  links: OutboundTextLink[];
  onNavigate: (itemId: string) => void;
};

export function ItemOutboundLinksList({
  links,
  onNavigate,
}: ItemOutboundLinksListProps) {
  const { internal, external } = splitOutboundLinks(links);

  return (
    <div className="space-y-6">
      {internal.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
            В коллекторе
          </h3>
          <ul
            data-testid="item-outbound-internal-list"
            className="list-disc list-outside space-y-2 pl-5"
          >
            {internal.map((link) => {
              const label = outboundLinkLabel(link);
              if (link.status === "resolved" && link.resolvedItemId) {
                return (
                  <li key={link.position} className="min-w-0">
                    <a
                      href={itemPathHref(link.resolvedItemId)}
                      className={cn(
                        "inline text-base text-indigo-400 [box-decoration-break:clone]",
                        ITEM_MARKDOWN_LINK_BORDER_CLASS,
                      )}
                      onClick={(event) => {
                        event.preventDefault();
                        onNavigate(link.resolvedItemId!);
                      }}
                    >
                      {label}
                    </a>
                  </li>
                );
              }
              return (
                <li key={link.position} className="min-w-0">
                  <span
                    className={cn(
                      "inline text-base [box-decoration-break:clone]",
                      UNRESOLVED_LINK_CLASS,
                    )}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {external.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
            В интернет
          </h3>
          <ul
            data-testid="item-outbound-external-list"
            className="list-disc list-outside space-y-2 pl-5"
          >
            {external.map((link) => {
              const label = outboundLinkLabel(link);
              const urlHint = externalOutboundUrlHint(link);
              return (
                <li key={link.position} className="min-w-0">
                  <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <ExternalAnchor
                      href={link.rawTarget}
                      className={cn(
                        "inline text-base text-indigo-400 [box-decoration-break:clone]",
                        ITEM_MARKDOWN_LINK_BORDER_CLASS,
                      )}
                    >
                      {label}
                    </ExternalAnchor>
                    {urlHint ? (
                      <>
                        <span
                          className="text-sm text-neutral-500 dark:text-neutral-400"
                          aria-hidden="true"
                        >
                          -
                        </span>
                        <span className="text-sm text-neutral-500 break-all dark:text-neutral-400">
                          {urlHint}
                        </span>
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
