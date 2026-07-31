import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { parseSettingsSection } from "../types/sidebar-mode";
import { McpSettingsSection } from "./McpSettingsSection";
import { SettingsGeneralSection } from "./SettingsGeneralSection";
import { SettingsUpdatesSection } from "./SettingsUpdatesSection";
import { TelegramSettingsSection } from "./TelegramSettingsSection";

export function SettingsPage() {
  const [searchParams] = useSearchParams();
  const section = parseSettingsSection(searchParams.get("section"));
  const [error, setError] = useState<string | null>(null);
  const onError = useCallback((message: string | null) => {
    setError(message);
  }, []);

  if (section === "mcp") {
    return <McpSettingsSection />;
  }

  if (section === "telegram") {
    return <TelegramSettingsSection />;
  }

  return (
    <div className="max-w-2xl pb-4 md:pb-8">
      {error && (
        <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      <section className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-800 divide-y divide-black/10 dark:divide-white/10">
        <SettingsGeneralSection onError={onError} />
        <SettingsUpdatesSection />
      </section>
    </div>
  );
}
