import { isTauri } from "@tauri-apps/api/core";

export function isDevMock(): boolean {
  if (import.meta.env.VITE_DEV_MOCK === "0") {
    return false;
  }
  if (import.meta.env.VITE_DEV_MOCK === "1") {
    return true;
  }
  return import.meta.env.DEV && !isTauri();
}
