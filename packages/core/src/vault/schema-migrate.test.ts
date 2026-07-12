import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION } from "@collector/shared";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { migrateVaultSchema } from "../vault/schema-migrate.js";
import { itemRoot, itemsRoot } from "../vault/paths.js";

describe("migrateVaultSchema", () => {
  let vaultPath = "";

  afterEach(async () => {
    if (vaultPath) {
      await rm(vaultPath, { recursive: true, force: true });
      vaultPath = "";
    }
  });

  it("migrates a v1 vault fixture to current schema without data loss", async () => {
    const fs = new NodeFileSystemAdapter();
    const root = await mkdtemp(join(tmpdir(), "collector-vault-v1-"));
    vaultPath = root;
    const itemId = "11111111-1111-4111-8111-111111111111";
    const timestamp = "2026-01-01T00:00:00.000Z";

    await writeFile(
      join(vaultPath, "vault.meta.json"),
      JSON.stringify(
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Legacy Vault",
          description: "",
          is_default: true,
          schema_version: 1,
          created_at: timestamp,
          updated_at: timestamp,
        },
        null,
        2,
      ),
    );

    const itemDir = itemRoot(vaultPath, itemId);
    await mkdir(itemDir, { recursive: true });
    await writeFile(
      join(itemDir, "item.json"),
      JSON.stringify(
        {
          id: itemId,
          vault_id: "22222222-2222-4222-8222-222222222222",
          title: "Legacy note",
          description: "keep me",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          is_archived: false,
          is_favorite: false,
          created_at: timestamp,
          updated_at: timestamp,
        },
        null,
        2,
      ),
    );
    await writeFile(join(itemDir, "content.md"), "# Legacy");

    const meta = await migrateVaultSchema(fs, vaultPath);
    expect(meta.schema_version).toBe(SCHEMA_VERSION);
    expect(meta.settings).toEqual({});

    const migratedItem = JSON.parse(
      await readFile(join(itemDir, "item.json"), "utf8"),
    );
    expect(migratedItem.title).toBe("Legacy note");
    expect(migratedItem.tag_ids).toEqual([]);
    expect(migratedItem.collection_ids).toEqual([]);
    expect(migratedItem.content_revision).toBe(1);

    const migratedVault = JSON.parse(
      await readFile(join(vaultPath, "vault.meta.json"), "utf8"),
    );
    expect(migratedVault.schema_version).toBe(SCHEMA_VERSION);
    expect(migratedVault.settings).toEqual({});

    expect(await fs.exists(itemsRoot(vaultPath))).toBe(true);
  });
});
