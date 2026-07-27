/** Same chrome as «Добавить»: secondary, no border. */
export const headerChromeBtn =
  "dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:text-neutral-100";

/** Active control — darker than the default secondary chrome. */
export const headerChromeBtnActive =
  "bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_18%)] hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_22%)] dark:bg-neutral-900 dark:hover:bg-neutral-950 dark:text-neutral-100";

/** Path strip — recessed vs header/buttons, not clickable chrome. */
export const headerPathChrome =
  "rounded-lg bg-neutral-100 px-3 dark:bg-neutral-900";
