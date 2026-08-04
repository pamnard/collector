import { useLocation, useNavigate } from "react-router-dom";
import { ItemAdjacentNav } from "../../items/ItemAdjacentNav";
import { useItemChromeAdjacent } from "./item-chrome-context";

export function ItemChromeAdjacentFooter() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const itemAdjacent = useItemChromeAdjacent();
  const onItemRoute = pathname.startsWith("/item/");
  if (
    !onItemRoute ||
    itemAdjacent === null ||
    (!itemAdjacent.prev && !itemAdjacent.next)
  ) {
    return null;
  }

  return (
    <footer className="relative shrink-0 border-t border-neutral-200 dark:border-neutral-700">
      <div className="px-4 py-5 md:px-8 md:py-6">
        <ItemAdjacentNav
          adjacent={itemAdjacent}
          onNavigate={(itemId) => navigate(`/item/${itemId}`)}
        />
      </div>
    </footer>
  );
}
