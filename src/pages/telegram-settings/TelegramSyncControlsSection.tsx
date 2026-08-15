import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "../../components/ui/input-group";

type Props = {
  busy: boolean;
  loading: boolean;
  syncIntervalMinutes: number;
  setSyncIntervalMinutes: (value: number) => void;
  lastSyncLabel: string;
  changeIntervalMinutes: (raw: string) => Promise<void>;
  syncNow: () => Promise<void>;
};

export function TelegramSyncControlsSection({
  busy,
  loading,
  syncIntervalMinutes,
  setSyncIntervalMinutes,
  lastSyncLabel,
  changeIntervalMinutes,
  syncNow,
}: Props) {
  return (
    <>
      <div className="p-4">
        <p className="font-medium">Интервал</p>
        <p className="text-neutral-500 dark:text-neutral-400 mt-1">
          Первый синк после запуска приложения, дальше каждые N минут.
        </p>
        <InputGroup className="mt-2 max-w-[10rem]">
          <InputGroupInput
            type="number"
            min={1}
            step={1}
            value={String(syncIntervalMinutes)}
            disabled={busy || loading}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next) && next >= 1) {
                setSyncIntervalMinutes(Math.floor(next));
              } else if (e.target.value === "") {
                setSyncIntervalMinutes(1);
              }
            }}
            onBlur={(e) => {
              void changeIntervalMinutes(e.target.value);
            }}
            aria-label="Интервал синхронизации в минутах"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>мин</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <div className="p-4 flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">Синхронизация</p>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1">
            Последняя: {lastSyncLabel}
          </p>
        </div>
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => void syncNow()}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-50"
        >
          Синхронизировать
        </button>
      </div>
    </>
  );
}
