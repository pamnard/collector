import { Check, ChevronDown, ChevronUp, Copy, X } from "lucide-react";
import { useState, type ReactNode } from "react";

export type AlertTone = "warning" | "danger" | "info";

/**
 * Soft tone border (/30) + tinted glass (~/20–25).
 * Not /10 (unreadable) and not white/95 slab (opaque, colorless).
 */
const toneClasses: Record<AlertTone, string> = {
  warning: "border-amber-500/30 bg-amber-500/20 dark:bg-amber-500/25",
  danger: "border-red-500/30 bg-red-500/20 dark:bg-red-500/25",
  info: "border-indigo-500/30 bg-indigo-500/20 dark:bg-indigo-500/25",
};

const iconBtnClass =
  "shrink-0 text-neutral-500 dark:text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100";

interface AlertProps {
  tone: AlertTone;
  children: ReactNode;
  /** Technical dump; shown only when expanded via chevron. */
  detail?: string;
  onDismiss?: () => void;
}

/** Single alert chrome. No spinner — callers compose content. */
export function Alert({ tone, children, detail, onDismiss }: AlertProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasDetail = detail !== undefined && detail.length > 0;

  async function copyDetail(): Promise<void> {
    if (!hasDetail) {
      return;
    }
    await navigator.clipboard.writeText(detail);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <div
      role="status"
      className={`pointer-events-auto overflow-hidden rounded-lg border px-4 py-2 text-sm shadow-lg backdrop-blur-md ${toneClasses[tone]}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 break-words">{children}</div>
        {hasDetail ? (
          <button
            type="button"
            onClick={() => {
              setExpanded((v) => !v);
            }}
            className={iconBtnClass}
            aria-expanded={expanded}
            aria-label={expanded ? "Скрыть подробности" : "Показать подробности"}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className={iconBtnClass}
            aria-label="Скрыть"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
      {hasDetail && expanded ? (
        <div className="mt-2 border-t border-black/5 dark:border-white/10 pt-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                void copyDetail();
              }}
              className={`${iconBtnClass} absolute top-1 right-1.5 z-10`}
              aria-label="Копировать подробности"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <pre className="custom-scrollbar max-h-40 overflow-y-auto whitespace-pre-wrap break-all py-1 pr-8 font-mono text-xs text-neutral-700 dark:text-neutral-300">
              {detail}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
