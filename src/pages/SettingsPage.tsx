import { useSearchParams } from "react-router-dom";
import { parseSettingsSection } from "../types/sidebar-mode";
import { McpSettingsSection } from "./McpSettingsSection";
import { SettingsGeneralSection } from "./SettingsGeneralSection";
import { SettingsUpdatesSection } from "./SettingsUpdatesSection";
import { TelegramSettingsSection } from "./TelegramSettingsSection";

export function SettingsPage() {
  const [searchParams] = useSearchParams();
  const section = parseSettingsSection(searchParams.get("section"));

  if (section === "mcp") {
    return <McpSettingsSection />;
  }

  if (section === "telegram") {
    return <TelegramSettingsSection />;
  }

  return (
    <div className="max-w-2xl pb-4 md:pb-8">
      <section className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-800 divide-y divide-black/10 dark:divide-white/10">
        <SettingsGeneralSection />
        <SettingsUpdatesSection />
      </section>
    </div>
  );
}
