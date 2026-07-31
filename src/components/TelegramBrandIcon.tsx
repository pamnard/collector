import { siTelegram } from "simple-icons";

/** Telegram brand mark from Simple Icons (#415). Not Lucide. */
export function TelegramBrandIcon(props: {
  className?: string;
  title?: string;
  "aria-hidden"?: boolean | "true" | "false";
}) {
  const title = props.title ?? "Telegram";
  const decorative = props["aria-hidden"] === true || props["aria-hidden"] === "true";
  return (
    <svg
      role={decorative ? "presentation" : "img"}
      viewBox="0 0 24 24"
      className={props.className}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
    >
      {decorative ? null : <title>{title}</title>}
      <path fill="currentColor" d={siTelegram.path} />
    </svg>
  );
}
