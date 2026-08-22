import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ItemAdjacentNav } from "../../items/ItemAdjacentNav";
import { ItemRelatedPanel } from "../../items/ItemRelatedPanel";
import type { ItemLinksTabId } from "../../items/item-links-panel-tabs";
import { useItemBacklinks } from "../../../hooks/useItemBacklinks";
import { useItemOutboundLinks } from "../../../hooks/useItemOutboundLinks";
import { useRelatedSemanticTeasers } from "../../../hooks/useRelatedSemanticTeasers";
import { useShell } from "../AppLayout";
import {
  useItemChromeAdjacent,
  useItemChromeItem,
} from "./item-chrome-context";

/**
 * Bottom item chrome: related/outgoing/backlinks tabs + adjacent nav.
 * `mt-auto` keeps the stack at the card bottom (links stick to adjacent).
 */
export function ItemChromeItemFooter() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { vaultRevision } = useShell();
  const onItemRoute = pathname.startsWith("/item/");
  const itemAdjacent = useItemChromeAdjacent();
  const chromeItem = useItemChromeItem();
  const itemRef = onItemRoute ? chromeItem : null;
  const { teasers: relatedTeasers, ready: relatedReady } =
    useRelatedSemanticTeasers(itemRef, vaultRevision);
  const backlinks = useItemBacklinks(itemRef, vaultRevision);
  const outbound = useItemOutboundLinks(itemRef, vaultRevision);
  const [preferredLinksTab, setPreferredLinksTab] =
    useState<ItemLinksTabId>("related");

  const showAdjacent =
    onItemRoute &&
    itemAdjacent !== null &&
    Boolean(itemAdjacent.prev || itemAdjacent.next);

  const linksSettled =
    relatedReady && backlinks !== null && outbound !== null;
  const showLinksPanel =
    linksSettled &&
    (relatedTeasers !== null || backlinks.length > 0 || outbound.length > 0);

  if (!showLinksPanel && !showAdjacent) {
    return null;
  }

  return (
    <div className="relative mt-auto shrink-0">
      {showLinksPanel && backlinks !== null && outbound !== null ? (
        <ItemRelatedPanel
          teasers={relatedTeasers}
          outbound={outbound}
          backlinks={backlinks}
          preferredTab={preferredLinksTab}
          onPreferredTabChange={setPreferredLinksTab}
          onNavigate={(itemId) => navigate(`/item/${itemId}`)}
        />
      ) : null}
      {showAdjacent && itemAdjacent ? (
        <footer className="border-t border-neutral-200 dark:border-neutral-700">
          <div className="px-4 py-5 md:px-8 md:py-6">
            <ItemAdjacentNav
              adjacent={itemAdjacent}
              onNavigate={(itemId) => navigate(`/item/${itemId}`)}
            />
          </div>
        </footer>
      ) : null}
    </div>
  );
}
