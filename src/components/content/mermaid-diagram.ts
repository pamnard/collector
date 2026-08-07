import type { Theme } from "../../hooks/useTheme.ts";
import { errorMessage } from "../../services/runtime-error.ts";

type MermaidDefault = typeof import("mermaid").default;

let mermaidLoad: Promise<MermaidDefault> | undefined;
let initializedTheme: "dark" | "default" | undefined;

/** Load Mermaid once; re-initialize only when app theme changes. */
export async function getMermaid(theme: Theme): Promise<MermaidDefault> {
  if (!mermaidLoad) {
    mermaidLoad = import("mermaid").then((mod) => mod.default);
  }
  const mermaid = await mermaidLoad;
  const nextTheme = theme === "dark" ? "dark" : "default";
  if (initializedTheme !== nextTheme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: nextTheme,
    });
    initializedTheme = nextTheme;
  }
  return mermaid;
}

export function mermaidDisplayError(error: unknown): string {
  const message = errorMessage(error).trim();
  return message || "Unknown Mermaid error";
}

/** Mermaid render ids must be CSS-safe; React useId includes colons. */
export function mermaidRenderDomId(reactId: string): string {
  const safe = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `mermaid-${safe || "diagram"}`;
}
