import { Switch } from "../../components/ui/switch";

type Props = {
  enabled: boolean;
  busy: boolean;
  loading: boolean;
  toggleEnabled: (next: boolean) => Promise<void>;
};

export function TelegramEnableSection({
  enabled,
  busy,
  loading,
  toggleEnabled,
}: Props) {
  return (
    <div className="p-4 flex items-center justify-between gap-4">
      <div>
        <p className="font-medium">Включить</p>
        <p className="text-neutral-500 dark:text-neutral-400 mt-1">
          {enabled ? "Синхронизация включена" : "Синхронизация выключена"}
        </p>
      </div>
      <Switch
        checked={enabled}
        disabled={busy || loading}
        onCheckedChange={(checked) => {
          void toggleEnabled(checked);
        }}
        aria-label="Включить синхронизацию"
      />
    </div>
  );
}
