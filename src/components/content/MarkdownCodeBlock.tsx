import { Check, Copy } from "lucide-react";
import {
  Children,
  isValidElement,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button } from "../ui/button";

function extractText(node: ReactNode): string {
  if (typeof node === "string") {
    return node;
  }
  if (typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return "";
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function extractLanguage(className: string | undefined): string | null {
  if (!className) {
    return null;
  }
  const match = className.match(/language-([\w-]+)/);
  return match?.[1] ?? null;
}

function isCodeElement(
  child: ReactNode,
): child is ReactElement<ComponentPropsWithoutRef<"code">> {
  return isValidElement(child) && child.type === "code";
}

function CopyCodeButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch (error) {
      console.error("Markdown code block copy failed", { error });
      setState("error");
      window.setTimeout(() => setState("idle"), 2000);
    }
  }

  const label =
    state === "copied"
      ? "Скопировано"
      : state === "error"
        ? "Не удалось скопировать"
        : "Скопировать код";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => void handleCopy()}
    >
      {state === "copied" ? <Check /> : <Copy />}
    </Button>
  );
}

export function MarkdownPre({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"pre">) {
  const child = Children.toArray(children)[0];
  if (!isCodeElement(child)) {
    return (
      <pre className={className} {...props}>
        {children}
      </pre>
    );
  }

  const codeText = extractText(child.props.children);
  const lines = splitLines(codeText);
  const language = extractLanguage(child.props.className);

  return (
    <div className="markdown-code-block not-prose">
      <div className="markdown-code-block-toolbar">
        {language ? (
          <span className="markdown-code-block-language">{language}</span>
        ) : (
          <span />
        )}
        <CopyCodeButton text={codeText} />
      </div>
      <div className="markdown-code-block-frame">
        <div className="markdown-code-block-gutter" aria-hidden="true">
          {lines.map((_, index) => (
            <span key={index} className="markdown-code-block-line-number">
              {index + 1}
            </span>
          ))}
        </div>
        <pre {...props} className={`markdown-code-block-pre ${className ?? ""}`}>
          {children}
        </pre>
      </div>
    </div>
  );
}
