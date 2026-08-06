/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_MOCK?: string;
  /** Domain host HTTP base URL for browser cutover (#551). */
  readonly VITE_COLLECTOR_SERVICE_BASE_URL?: string;
  /** Domain host Bearer token for browser cutover (#551). */
  readonly VITE_COLLECTOR_SERVICE_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
