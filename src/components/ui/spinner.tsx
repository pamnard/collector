import { LoaderIcon } from "lucide-react";

/** shadcn-style spinner (LoaderIcon + spin). */
export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof LoaderIcon>) {
  const classes = ["size-4", "animate-spin", className].filter(Boolean).join(" ");
  return (
    <LoaderIcon
      role="status"
      aria-label="Loading"
      className={classes}
      {...props}
    />
  );
}
