import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "../../hooks/useTheme";
import {
  getMermaid,
  mermaidDisplayError,
  mermaidRenderDomId,
} from "./mermaid-diagram";

type MermaidDiagramProps = {
  source: string;
};

type RenderState =
  | { status: "loading" }
  | {
      status: "ok";
      svg: string;
      bindFunctions?: (element: Element) => void;
    }
  | { status: "error"; message: string };

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const reactId = useId();
  const baseId = mermaidRenderDomId(reactId);
  const renderSeq = useRef(0);
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RenderState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    renderSeq.current += 1;
    const renderId = `${baseId}-${renderSeq.current}`;

    async function renderDiagram() {
      setState({ status: "loading" });
      try {
        const mermaid = await getMermaid(theme);
        const { svg, bindFunctions } = await mermaid.render(renderId, source);
        if (cancelled) {
          return;
        }
        setState({ status: "ok", svg, bindFunctions });
      } catch (error) {
        console.error("Mermaid diagram render failed", {
          error,
          renderId,
          sourceLength: source.length,
        });
        if (!cancelled) {
          setState({ status: "error", message: mermaidDisplayError(error) });
        }
      }
    }

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [source, theme, baseId]);

  useLayoutEffect(() => {
    if (state.status !== "ok" || !state.bindFunctions) {
      return;
    }
    const el = containerRef.current;
    if (el) {
      state.bindFunctions(el);
    }
  }, [state]);

  if (state.status === "loading") {
    return (
      <div className="markdown-mermaid-body custom-scrollbar" aria-busy="true">
        <p className="markdown-mermaid-status">Загрузка диаграммы…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="markdown-mermaid-body custom-scrollbar" role="alert">
        <p className="markdown-mermaid-error-title">
          Не удалось нарисовать диаграмму
        </p>
        <p className="markdown-mermaid-error-message">{state.message}</p>
        <pre className="markdown-mermaid-source custom-scrollbar">{source}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="markdown-mermaid-body markdown-mermaid-svg custom-scrollbar"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
