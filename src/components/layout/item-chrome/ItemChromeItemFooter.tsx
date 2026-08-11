import { useLocation, useNavigate } from "react-router-dom";
import { ItemAdjacentNav } from "../../items/ItemAdjacentNav";
import { ItemRelatedPanel } from "../../items/ItemRelatedPanel";
import { useRelatedSemanticTeasers } from "../../../hooks/useRelatedSemanticTeasers";
import {
  useItemChromeAdjacent,
  useItemChromeItem,
} from "./item-chrome-context";

/**
 * Bottom item chrome: related teasers + adjacent nav.
 * `mt-auto` keeps the stack at the card bottom (related sticks to adjacent).
 */
export function ItemChromeItemFooter() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onItemRoute = pathname.startsWith("/item/");
  const itemAdjacent = useItemChromeAdjacent();
  const chromeItem = useItemChromeItem();
  const relatedTeasers = useRelatedSemanticTeasers(
    onItemRoute ? chromeItem : null,
  );

  const showAdjacent =
    onItemRoute &&
    itemAdjacent !== null &&
    Boolean(itemAdjacent.prev || itemAdjacent.next);

  if (!relatedTeasers && !showAdjacent) {
    return null;
  }

  return (
    <div className="relative mt-auto shrink-0">
      {relatedTeasers ? (
        <ItemRelatedPanel
          teasers={relatedTeasers}
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
