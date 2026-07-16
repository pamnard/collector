import { X } from "lucide-react";
import type { ReactNode } from "react";

export type AlertTone = "warning" | "danger" | "info";

const toneClasses: Record<AlertTone, string> = {
  warning: "border-amber-500/30 bg-amber-500/10",
  danger: "border-red-500/30 bg-red-500/10",
  info: "border-indigo-500/30 bg-indigo-500/10",
};

interface AlertProps {
  tone: AlertTone;
  children: ReactNode;
  onDismiss?: () => void;
}

/** Single alert chrome. No spinner — callers compose content. */
export function Alert({ tone, children, onDismiss }: AlertProps) {
  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-2 text-sm shadow-lg backdrop-blur-md ${toneClasses[tone]}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-secondary transition-colors hover:text-primary"
          aria-label="Скрыть"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
