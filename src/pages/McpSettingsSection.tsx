import { useEffect, useState } from "react";
import { COLLECTOR_MCP_TOOLS } from "@collector/mcp/tools-catalog";
import { MarkdownPre } from "../components/content/MarkdownCodeBlock";
import {
  buildMcpClientConfigJson,
  getMcpStdioCommand,
} from "../services/mcp-setup";
import { getCollectorService } from "../services/collector-client";

export function McpSettingsSection() {
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [command, setCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCollectorService().boot
      .getDataDirectory()
      .then((directory) => {
        if (!cancelled) {
          setDataDir(directory.trim() ? directory : null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    getMcpStdioCommand()
      .then((mcpCommand) => {
        if (!cancelled) {
          setCommand(mcpCommand);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const configJson = buildMcpClientConfigJson({ command, dataDir });

  return (
    <div className="max-w-2xl pb-4 md:pb-8">
      {error && (
        <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      <section className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-800 divide-y divide-black/10 dark:divide-white/10">
        <div className="p-4 space-y-2">
          <p className="font-medium">Зачем это</p>
          <p className="text-neutral-500 dark:text-neutral-400">
            Можно подключить Collector к ассистенту (Cursor, Claude Desktop и
            другим). Пока приложение открыто, ассистент сможет искать и менять
            заметки в твоём хранилище.
          </p>
        </div>

        <div className="p-4 space-y-2">
          <p className="font-medium">Как подключить</p>
          <ol className="list-decimal list-inside text-neutral-500 dark:text-neutral-400 space-y-1">
            <li>Оставь Collector запущенным.</li>
            <li>Скопируй конфиг ниже.</li>
            <li>Вставь его в настройки MCP своего ассистента.</li>
            <li>Если ассистент просит — перезапусти подключение MCP.</li>
          </ol>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <p className="font-medium">Конфиг для ассистента</p>
            <p className="text-neutral-500 dark:text-neutral-400 mt-1">
              Вставь этот JSON в настройки MCP.
            </p>
          </div>
          <MarkdownPre>
            <code className="language-json">{configJson}</code>
          </MarkdownPre>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <p className="font-medium">Что умеет ассистент</p>
            <p className="text-neutral-500 dark:text-neutral-400 mt-1">
              Список команд такой же, какой видит ассистент. Технические детали —
              по нажатию.
            </p>
          </div>
          <div className="divide-y divide-black/10 dark:divide-white/10">
            {COLLECTOR_MCP_TOOLS.map((tool) => (
              <div key={tool.name} className="py-3 first:pt-0 last:pb-0">
                <p className="font-mono">{tool.name}</p>
                <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                  {tool.description}
                </p>
                <details className="mt-2 text-neutral-500 dark:text-neutral-400">
                  <summary className="cursor-pointer text-indigo-600 dark:text-indigo-400 select-none">
                    Параметры и детали
                  </summary>
                  <pre className="mt-2 rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/40 dark:bg-neutral-900/40 p-3 font-mono whitespace-pre-wrap">
                    {tool.params.length === 0
                      ? "(нет параметров)"
                      : tool.params
                          .map(
                            (param) =>
                              `${param.name}: ${param.typeLabel}${param.required ? " (required)" : " (optional)"}\n  ${param.description}`,
                          )
                          .join("\n\n")}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
