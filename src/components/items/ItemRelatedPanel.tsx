import type { RelatedTeaser } from "../../lib/related-teaser";

type ItemRelatedPanelProps = {
  teasers: RelatedTeaser[];
  onNavigate: (itemId: string) => void;
};

/** Related teasers above adjacent nav. Fixed 6× text links until #605. */
export function ItemRelatedPanel({
  teasers,
  onNavigate,
}: ItemRelatedPanelProps) {
  return (
    <section
      data-testid="item-related-panel"
      className="border-t border-neutral-200 dark:border-neutral-700"
      aria-label="Релевантные"
    >
      <div className="px-4 py-5 md:px-8 md:py-6">
        <h2 className="mb-3 text-sm font-medium">Релевантные</h2>
        <ul className="flex flex-col gap-2">
          {teasers.map((teaser) => (
            <li key={teaser.id}>
              <button
                type="button"
                className="w-full cursor-pointer truncate text-left text-sm text-neutral-800 hover:underline dark:text-neutral-100"
                onClick={() => onNavigate(teaser.id)}
              >
                {teaser.title.trim() || teaser.id}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
