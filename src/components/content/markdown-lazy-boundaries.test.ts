/**
 * Runtime guard (#802): markdown / mermaid / MCP markdown stay behind
 * React.lazy + Suspense — not a source-text grep for `lazy(`.
 *
 * Loads real production modules via Vite SSR and asserts observable
 * element-tree + dynamic-import factory behavior.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import type { ItemFile } from "@collector/shared";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const REACT_LAZY = Symbol.for("react.lazy");
const REACT_SUSPENSE = Symbol.for("react.suspense");

type LazyComponentType = {
  $$typeof: symbol;
  _payload: {
    _status: number;
    _result: (() => Promise<{ default: unknown }>) | Promise<{ default: unknown }> | { default: unknown };
  };
};

function testMocksPlugin(): Plugin {
  return {
    name: "markdown-lazy-boundaries-mocks",
    enforce: "pre",
    resolveId(id) {
      if (id.includes("hooks/useTheme")) {
        return "\0mock-useTheme";
      }
      if (id.includes("services/collector-client")) {
        return "\0mock-collector-client";
      }
      if (id.includes("services/mcp-setup")) {
        return "\0mock-mcp-setup";
      }
    },
    load(id) {
      if (id === "\0mock-useTheme") {
        return "export function useTheme(){return{theme:'light',toggleTheme(){}}}";
      }
      if (id === "\0mock-collector-client") {
        return [
          "export function getCollectorService(){",
          "  return { boot: { getDataDirectory: () => new Promise(() => {}) } };",
          "}",
          "export function getUiSession(){ return null; }",
        ].join("\n");
      }
      if (id === "\0mock-mcp-setup") {
        return [
          "export function buildMcpClientConfigJson(){ return '{}'; }",
          "export function getMcpStdioCommand(){ return new Promise(() => {}); }",
        ].join("\n");
      }
    },
  };
}

function walkElements(node: ReactNode, visit: (el: ReactElement) => void): void {
  if (node == null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      walkElements(child, visit);
    }
    return;
  }
  if (!isValidElement(node)) {
    return;
  }
  visit(node);
  walkElements(node.props.children as ReactNode, visit);
}

function isLazyType(type: unknown): type is LazyComponentType {
  return (
    type != null &&
    typeof type === "object" &&
    (type as LazyComponentType).$$typeof === REACT_LAZY
  );
}

function findSuspenseLazyChild(tree: ReactNode): ReactElement | null {
  let found: ReactElement | null = null;
  walkElements(tree, (el) => {
    if (found || el.type !== REACT_SUSPENSE) {
      return;
    }
    const child = el.props.children;
    if (isValidElement(child) && isLazyType(child.type)) {
      found = child;
    }
  });
  return found;
}

async function resolveLazyDefault(
  lazyType: LazyComponentType,
): Promise<(...args: never[]) => unknown> {
  const payload = lazyType._payload;
  // Uninitialized: `_result` is the dynamic-import factory from React.lazy(...).
  if (payload._status === -1) {
    if (typeof payload._result !== "function") {
      throw new Error(
        "lazy payload uninitialized but _result is not a factory function",
      );
    }
    const mod = await payload._result();
    if (typeof mod?.default !== "function") {
      throw new Error("lazy factory did not resolve to { default: Component }");
    }
    return mod.default as (...args: never[]) => unknown;
  }
  throw new Error(
    `expected uninitialized lazy payload (-1), got status ${String(payload._status)}`,
  );
}

function stubItem(id: string): ItemFile {
  return {
    id,
    title: id,
    description: "",
    url: null,
    content_type: "note",
    tag_ids: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    thumbnail: null,
  } as ItemFile;
}

describe("markdown stack lazy boundaries (#802)", () => {
  let server: ViteDevServer;

  before(async () => {
    server = await createServer({
      root,
      configFile: false,
      plugins: [testMocksPlugin(), react()],
      resolve: {
        alias: {
          "@": path.resolve(root, "src"),
          "@collector/shared": path.resolve(
            root,
            "packages/shared/src/index.ts",
          ),
          "@collector/api": path.resolve(root, "packages/api/src/index.ts"),
          "@collector/core": path.resolve(root, "packages/core/src/index.ts"),
          "@collector/mcp/tools-catalog": path.resolve(
            root,
            "packages/mcp/src/tools-catalog.ts",
          ),
        },
        conditions: ["@collector/source"],
      },
      optimizeDeps: { noDiscovery: true },
      server: { middlewareMode: true, ws: false },
      appType: "custom",
    });
  });

  after(async () => {
    await server.close();
  });

  it("ItemDetailViewBody suspends on a lazy MarkdownContent split", async () => {
    const { ItemDetailViewBody } = await server.ssrLoadModule(
      "/src/components/items/ItemDetailViewBody.tsx",
    );
    const item = stubItem("note-1");

    const withoutBody = ItemDetailViewBody({
      item,
      content: null,
      aside: null,
    });
    assert.equal(
      findSuspenseLazyChild(withoutBody),
      null,
      "no markdown Suspense/lazy when content is absent",
    );

    const withBody = ItemDetailViewBody({
      item,
      content: "# hello",
      aside: null,
    });
    const lazyChild = findSuspenseLazyChild(withBody);
    assert.ok(lazyChild, "markdown path must wrap a React.lazy child in Suspense");
    assert.equal(lazyChild.props.itemId, item.id);
    assert.equal(lazyChild.props.content, "# hello");

    const resolved = await resolveLazyDefault(lazyChild.type as LazyComponentType);
    assert.equal(resolved.name, "MarkdownContent");
  });

  it("MarkdownPre suspends on a lazy MermaidDiagram only for mermaid fences", async () => {
    const { MarkdownPre } = await server.ssrLoadModule(
      "/src/components/content/MarkdownCodeBlock.tsx",
    );

    const jsTree = MarkdownPre({
      children: createElement("code", { className: "language-js" }, "const x = 1"),
    });
    assert.equal(
      findSuspenseLazyChild(jsTree),
      null,
      "non-mermaid fences must not mount the mermaid lazy boundary",
    );

    const mermaidTree = MarkdownPre({
      children: createElement(
        "code",
        { className: "language-mermaid" },
        "graph TD; A-->B",
      ),
    });
    const lazyChild = findSuspenseLazyChild(mermaidTree);
    assert.ok(lazyChild, "mermaid fence must Suspense a React.lazy child");

    const resolved = await resolveLazyDefault(lazyChild.type as LazyComponentType);
    assert.equal(resolved.name, "MermaidDiagram");
  });

  it("McpSettingsSection suspends on a lazy MarkdownPre split", async () => {
    const { AlertBusProvider } = await server.ssrLoadModule(
      "/src/components/alerts/AlertBusProvider.tsx",
    );
    const { McpSettingsSection } = await server.ssrLoadModule(
      "/src/pages/McpSettingsSection.tsx",
    );
    const { MarkdownPre } = await server.ssrLoadModule(
      "/src/components/content/MarkdownCodeBlock.tsx",
    );

    let tree: ReactNode = null;
    function Capture(): null {
      tree = McpSettingsSection({});
      return null;
    }
    renderToStaticMarkup(
      createElement(AlertBusProvider, null, createElement(Capture)),
    );

    const lazyChild = findSuspenseLazyChild(tree);
    assert.ok(lazyChild, "MCP settings must Suspense a React.lazy MarkdownPre");

    const resolved = await resolveLazyDefault(lazyChild.type as LazyComponentType);
    assert.equal(resolved.name, "MarkdownPre");
    assert.equal(resolved, MarkdownPre);
  });
});
