/**
 * Sync-plugin credential storage (#30).
 *
 * Secrets live in the OS keychain via an injectable {@link KeychainBackend}.
 * Production uses `@napi-rs/keyring`. Never vault files / app-settings JSON.
 */

import { createRequire } from "node:module";
import type {
  CredentialRef,
  CredentialsAvailability,
  CredentialsPort,
} from "@collector/api";

/** Keychain service name — matches Tauri app identifier. */
export const CREDENTIALS_KEYCHAIN_SERVICE = "com.collector.app";

export interface KeychainBackend {
  availability(): CredentialsAvailability;
  setPassword(account: string, secret: string): void;
  getPassword(account: string): string | null;
  deletePassword(account: string): void;
}

export interface CredentialsServiceDeps {
  backend: KeychainBackend;
}

function requireCredentialPart(
  value: unknown,
  label: "pluginId" | "key",
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`credentials: ${label} must be a non-empty string`);
  }
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`credentials: ${label} contains illegal characters`);
  }
  return value;
}

export function credentialAccount(ref: CredentialRef): string {
  const pluginId = requireCredentialPart(ref.pluginId, "pluginId");
  const key = requireCredentialPart(ref.key, "key");
  return `${pluginId}.${key}`;
}

export function createMemoryKeychainBackend(): KeychainBackend {
  const store = new Map<string, string>();
  return {
    availability: () => ({ available: true }),
    setPassword(account, secret) {
      store.set(account, secret);
    },
    getPassword(account) {
      return store.has(account) ? (store.get(account) as string) : null;
    },
    deletePassword(account) {
      store.delete(account);
    },
  };
}

export function createUnavailableKeychainBackend(
  reason: string,
): KeychainBackend {
  const fail = (): never => {
    throw new Error(`credentials unavailable: ${reason}`);
  };
  return {
    availability: () => ({ available: false, reason }),
    setPassword: fail,
    getPassword: fail,
    deletePassword: fail,
  };
}

type KeyringEntry = {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
};

type KeyringEntryCtor = new (service: string, username: string) => KeyringEntry;

/**
 * Load `@napi-rs/keyring`. On module load failure → unavailable (no file fallback).
 */
export function createOsKeychainBackend(): KeychainBackend {
  let Entry: KeyringEntryCtor;
  try {
    const require = createRequire(import.meta.url);
    const mod = require("@napi-rs/keyring") as { Entry: KeyringEntryCtor };
    Entry = mod.Entry;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[collector] credentials: OS keychain binding unavailable:", {
      error: message,
    });
    return createUnavailableKeychainBackend(
      `OS keychain binding failed to load: ${message}`,
    );
  }

  const entryFor = (account: string) =>
    new Entry(CREDENTIALS_KEYCHAIN_SERVICE, account);

  return {
    availability: () => ({ available: true }),
    setPassword(account, secret) {
      entryFor(account).setPassword(secret);
    },
    getPassword(account) {
      try {
        return entryFor(account).getPassword();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (/no.?entry|not found|NoEntry/i.test(message)) {
          return null;
        }
        console.error("[collector] credentials: getPassword failed:", {
          account,
          error: message,
        });
        throw error;
      }
    },
    deletePassword(account) {
      try {
        entryFor(account).deletePassword();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (/no.?entry|not found|NoEntry/i.test(message)) {
          return;
        }
        console.error("[collector] credentials: deletePassword failed:", {
          account,
          error: message,
        });
        throw error;
      }
    },
  };
}

export function createCredentialsService(
  deps: CredentialsServiceDeps,
): CredentialsPort {
  const { backend } = deps;

  const assertAvailable = (): void => {
    const status = backend.availability();
    if (!status.available) {
      throw new Error(
        `credentials unavailable: ${status.reason ?? "OS keychain not available"}`,
      );
    }
  };

  return {
    async getCredentialsAvailability(): Promise<CredentialsAvailability> {
      return backend.availability();
    },

    async setCredential(input): Promise<void> {
      assertAvailable();
      const account = credentialAccount(input);
      if (typeof input.secret !== "string" || input.secret.length === 0) {
        throw new Error("credentials: secret must be a non-empty string");
      }
      backend.setPassword(account, input.secret);
    },

    async getCredential(input): Promise<string | null> {
      assertAvailable();
      return backend.getPassword(credentialAccount(input));
    },

    async hasCredential(input): Promise<boolean> {
      assertAvailable();
      return backend.getPassword(credentialAccount(input)) !== null;
    },

    async deleteCredential(input): Promise<void> {
      assertAvailable();
      backend.deletePassword(credentialAccount(input));
    },
  };
}
