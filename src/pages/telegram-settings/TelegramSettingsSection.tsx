import { useTelegramSettings } from "../../hooks/useTelegramSettings";
import { TelegramSettingsIntro } from "./TelegramSettingsIntro";
import { TelegramEnableSection } from "./TelegramEnableSection";
import { TelegramTokenSection } from "./TelegramTokenSection";
import { TelegramFolderSection } from "./TelegramFolderSection";
import { TelegramSyncControlsSection } from "./TelegramSyncControlsSection";

export function TelegramSettingsSection() {
  const s = useTelegramSettings();

  return (
    <div className="max-w-2xl pb-4 md:pb-8">
      <section className="rounded-lg border border-black/10 dark:border-white/10 divide-y divide-black/10 dark:divide-white/10">
        <TelegramSettingsIntro credReason={s.credReason} />
        <TelegramEnableSection
          enabled={s.enabled}
          busy={s.busy}
          loading={s.loading}
          toggleEnabled={s.toggleEnabled}
        />
        <TelegramTokenSection
          hasToken={s.hasToken}
          botUsername={s.botUsername}
          tokenDraft={s.tokenDraft}
          setTokenDraft={s.setTokenDraft}
          busy={s.busy}
          loading={s.loading}
          credsAvailable={s.credsAvailable}
          saveToken={s.saveToken}
          clearToken={s.clearToken}
        />
        <TelegramFolderSection
          folderPath={s.folderPath}
          folderItems={s.folderItems}
          busy={s.busy}
          loading={s.loading}
          changeFolder={s.changeFolder}
        />
        <TelegramSyncControlsSection
          busy={s.busy}
          loading={s.loading}
          syncIntervalMinutes={s.syncIntervalMinutes}
          setSyncIntervalMinutes={s.setSyncIntervalMinutes}
          lastSyncLabel={s.lastSyncLabel}
          changeIntervalMinutes={s.changeIntervalMinutes}
          syncNow={s.syncNow}
        />
      </section>
    </div>
  );
}
