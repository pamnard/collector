import { isDevMock } from "../../dev/is-dev-mock";

export function DevMockBanner() {
  if (!isDevMock()) {
    return null;
  }

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-200">
      Dev mock — данные в памяти, Tauri не используется (#57)
    </div>
  );
}
