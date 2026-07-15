import { describe, expect, it } from "vitest";
import { itemsRoot } from "./paths.js";
import { parseVaultItemsWatchItemId } from "./vault-watch-path.js";

describe("parseVaultItemsWatchItemId", () => {
  const itemsDir = itemsRoot("/vault/root");

  it("returns item id for nested paths under items/", () => {
    expect(parseVaultItemsWatchItemId(itemsDir, `${itemsDir}/abc/item.json`)).toBe(
      "abc",
    );
    expect(
      parseVaultItemsWatchItemId(itemsDir, `${itemsDir}/abc/media/manifest.json`),
    ).toBe("abc");
  });

  it("ignores reconcile touch file and items root", () => {
    expect(parseVaultItemsWatchItemId(itemsDir, `${itemsDir}/.collector-touch`)).toBe(
      null,
    );
    expect(parseVaultItemsWatchItemId(itemsDir, itemsDir)).toBe(null);
  });

  it("returns null for paths outside items/", () => {
    expect(parseVaultItemsWatchItemId(itemsDir, "/vault/root/vault.json")).toBe(null);
  });
});
