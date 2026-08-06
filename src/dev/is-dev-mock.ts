export function isDevMock(): boolean {
  if (import.meta.env.VITE_DEV_MOCK === "0") {
    return false;
  }
  if (import.meta.env.VITE_DEV_MOCK === "1") {
    return true;
  }
  // Packaged UI + host cutover runs production build; Vite DEV alone is DevMock.
  return import.meta.env.DEV;
}
