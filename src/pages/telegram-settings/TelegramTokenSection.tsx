import { Input } from "../../components/ui/input";

type Props = {
  hasToken: boolean;
  botUsername: string | null;
  tokenDraft: string;
  setTokenDraft: (value: string) => void;
  busy: boolean;
  loading: boolean;
  credsAvailable: boolean;
  saveToken: () => Promise<void>;
  clearToken: () => Promise<void>;
};

export function TelegramTokenSection({
  hasToken,
  botUsername,
  tokenDraft,
  setTokenDraft,
  busy,
  loading,
  credsAvailable,
  saveToken,
  clearToken,
}: Props) {
  return (
    <div className="p-4">
      <p className="font-medium">Токен бота</p>
      <p className="text-neutral-500 dark:text-neutral-400 mt-1">
        {hasToken
          ? `Токен сохранён${botUsername ? ` · @${botUsername}` : ""}. Полный токен не показывается.`
          : "Токен ещё не сохранён."}
      </p>
      <Input
        type="password"
        autoComplete="off"
        placeholder={hasToken ? "Новый токен (замена)" : "123456:ABC..."}
        value={tokenDraft}
        disabled={busy || loading}
        onChange={(e) => setTokenDraft(e.target.value)}
        className="mt-2"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={
            !credsAvailable || busy || loading || !tokenDraft.trim()
          }
          onClick={() => void saveToken()}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-50"
        >
          Сохранить токен
        </button>
        <button
          type="button"
          disabled={!credsAvailable || busy || loading || !hasToken}
          onClick={() => void clearToken()}
          className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-sm disabled:opacity-50"
        >
          Очистить токен
        </button>
      </div>
    </div>
  );
}
