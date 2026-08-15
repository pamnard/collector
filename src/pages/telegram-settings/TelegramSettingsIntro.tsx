import { TelegramBrandIcon } from "../../components/TelegramBrandIcon";

type Props = {
  credReason: string | null;
};

export function TelegramSettingsIntro({ credReason }: Props) {
  return (
    <>
      <div className="p-4 flex items-center gap-3">
        <TelegramBrandIcon className="size-6 text-[#26A5E4]" />
        <div>
          <p className="font-medium">Telegram</p>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1">
            Пересылай сообщения своему боту — Collector заберёт их в vault.
          </p>
        </div>
      </div>

      {credReason ? (
        <div className="p-4 text-amber-700 dark:text-amber-300">
          {credReason}
        </div>
      ) : null}

      <div className="p-4">
        <p className="font-medium">Как настроить</p>
        <ol className="list-decimal list-inside text-neutral-500 dark:text-neutral-400 space-y-1 mt-1">
          <li>Создай бота у @BotFather и скопируй токен.</li>
          <li>Вставь токен ниже и сохрани.</li>
          <li>Напиши боту /start, затем шли или пересылай сообщения.</li>
          <li>
            Нажми «Синхронизировать», либо дождись автосинка после запуска и
            дальше по интервалу.
          </li>
        </ol>
      </div>
    </>
  );
}
