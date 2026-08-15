import {
  DOMAIN_WIRE_METHODS,
  type DomainWireMethod,
} from "../domain-methods.js";
import { CREDENTIALS_DISPATCH } from "./credentials.js";
import { DASHBOARD_DISPATCH } from "./dashboard.js";
import { FOLDERS_DISPATCH } from "./folders.js";
import { INDEX_BOOT_DISPATCH } from "./index-boot.js";
import { ITEMS_DISPATCH } from "./items.js";
import { MEDIA_DISPATCH } from "./media.js";
import { SETTINGS_DISPATCH } from "./settings.js";
import { SYNC_DISPATCH } from "./sync.js";
import { TAGS_DISPATCH } from "./tags.js";
import { TELEGRAM_DISPATCH } from "./telegram.js";
import type { DomainDispatchEntry, DomainDispatchGroup } from "./types.js";
import { VAULTS_DISPATCH } from "./vaults.js";
import { WATCHER_DISPATCH } from "./watcher.js";

function mergeDomainDispatchGroups(
  ...groups: DomainDispatchGroup[]
): Record<DomainWireMethod, DomainDispatchEntry> {
  const merged: DomainDispatchGroup = Object.assign({}, ...groups);
  assertDomainRegistryCoverage(merged);
  return merged as Record<DomainWireMethod, DomainDispatchEntry>;
}

/** Full host registry: every {@link DomainWireMethod} has exactly one entry. */
export const DOMAIN_DISPATCH_REGISTRY = mergeDomainDispatchGroups(
  INDEX_BOOT_DISPATCH,
  ITEMS_DISPATCH,
  TAGS_DISPATCH,
  FOLDERS_DISPATCH,
  MEDIA_DISPATCH,
  VAULTS_DISPATCH,
  SETTINGS_DISPATCH,
  CREDENTIALS_DISPATCH,
  SYNC_DISPATCH,
  TELEGRAM_DISPATCH,
  DASHBOARD_DISPATCH,
  WATCHER_DISPATCH,
);

function assertDomainRegistryCoverage(registry: DomainDispatchGroup): void {
  const catalog = new Set<string>(Object.values(DOMAIN_WIRE_METHODS));
  const registryKeys = Object.keys(registry);
  const missingFromRegistry: string[] = [];
  const extraInRegistry: string[] = [];

  for (const method of catalog) {
    if (!(method in registry)) {
      missingFromRegistry.push(method);
    }
  }
  for (const method of registryKeys) {
    if (!catalog.has(method)) {
      extraInRegistry.push(method);
    }
  }

  if (missingFromRegistry.length > 0 || extraInRegistry.length > 0) {
    const parts: string[] = [];
    if (missingFromRegistry.length > 0) {
      parts.push(`missing from registry: ${missingFromRegistry.join(", ")}`);
    }
    if (extraInRegistry.length > 0) {
      parts.push(`extra in registry: ${extraInRegistry.join(", ")}`);
    }
    throw new Error(`host wire domain registry coverage (#330): ${parts.join("; ")}`);
  }
}
