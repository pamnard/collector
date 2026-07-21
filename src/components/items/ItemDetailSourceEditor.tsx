import { useEffect, useRef } from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useTheme } from "../../hooks/useTheme";
import { darkHighlightStyle } from "../../lib/syntax-highlight-colors";

interface ItemDetailSourceEditorProps {
  value: string;
  onChange: (value: string) => void;
}

function sourceEditorTheme(dark: boolean) {
  const pageBg = dark ? "rgb(28 28 28)" : "rgb(255 255 255)";
  const text = dark ? "rgb(255 255 255)" : "rgb(17 24 39)";
  const gutterText = dark ? "rgb(107 114 128)" : "rgb(156 163 175)";
  const gutterTextActive = dark ? "rgb(156 163 175)" : "rgb(107 114 128)";

  return EditorView.theme(
    {
      "&": {
        height: "auto",
        backgroundColor: "transparent",
        fontSize: "0.875rem",
      },
      ".cm-scroller": {
        overflowX: "auto",
        overflowY: "hidden",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
        lineHeight: "1.625",
      },
      ".cm-content": {
        padding: "0",
        caretColor: text,
        color: text,
        minHeight: "12rem",
      },
      ".cm-line": {
        padding: "0 0 0 12px",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: text,
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: dark
          ? "rgb(99 102 241 / 0.35)"
          : "rgb(99 102 241 / 0.25)",
      },
      ".cm-activeLine": {
        backgroundColor: dark
          ? "rgb(255 255 255 / 0.04)"
          : "rgb(0 0 0 / 0.03)",
      },
      ".cm-gutters": {
        backgroundColor: pageBg,
        border: "none",
        color: gutterText,
        paddingRight: "4px",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        minWidth: "2.5rem",
        padding: "0 8px 0 4px",
        textAlign: "right",
      },
      ".cm-activeLineGutter": {
        backgroundColor: pageBg,
        color: gutterTextActive,
      },
    },
    { dark },
  );
}

function highlightExtension(dark: boolean) {
  return syntaxHighlighting(
    dark ? darkHighlightStyle : defaultHighlightStyle,
    { fallback: true },
  );
}

export function ItemDetailSourceEditor({
  value,
  onChange,
}: ItemDetailSourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const themeCompartment = useRef(new Compartment()).current;
  const highlightCompartment = useRef(new Compartment()).current;
  const { theme } = useTheme();
  const dark = theme === "dark";

  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          indentOnInput(),
          bracketMatching(),
          EditorView.lineWrapping,
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          yamlFrontmatter({
            content: markdown({ base: markdownLanguage }),
          }),
          themeCompartment.of(sourceEditorTheme(dark)),
          highlightCompartment.of(highlightExtension(dark)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.contentAttributes.of({
            "aria-label": "Исходный markdown",
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once when source mode opens (value is already loaded).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const current = view.state.doc.toString();
    if (current === value) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: [
        themeCompartment.reconfigure(sourceEditorTheme(dark)),
        highlightCompartment.reconfigure(highlightExtension(dark)),
      ],
    });
  }, [dark, themeCompartment, highlightCompartment]);

  return (
    <div ref={hostRef} className="item-source-editor w-full" />
  );
}
