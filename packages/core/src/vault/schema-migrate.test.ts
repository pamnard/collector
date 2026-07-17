import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION } from "@collector/shared";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { migrateVaultSchema } from "../vault/schema-migrate.js";
import { itemRoot, itemsRoot, RECONCILE_TOUCH_FILE } from "../vault/paths.js";
import { parseDocumentMarkdown } from "./frontmatter.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe("migrateVaultSchema", () => {
  let vaultPath = "";

  afterEach(async () => {
    if (vaultPath) {
      await rm(vaultPath, { recursive: true, force: true });
      vaultPath = "";
    }
  });

  it("migrates a v1 vault fixture to FM markdown without data loss", async () => {
    const fs = new NodeFileSystemAdapter();
    const root = await mkdtemp(join(tmpdir(), "collector-vault-v1-"));
    vaultPath = root;
    const itemId = "11111111-1111-4111-8111-111111111111";
    const vaultId = "22222222-2222-4222-8222-222222222222";
    const timestamp = "2026-01-01T00:00:00.000Z";

    await writeFile(
      join(vaultPath, "vault.meta.json"),
      JSON.stringify(
        {
          id: vaultId,
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
    await writeFile(join(vaultPath, "tags.json"), JSON.stringify({ tags: [] }));

    const itemDir = itemRoot(vaultPath, itemId);
    await mkdir(itemDir, { recursive: true });
    await writeFile(
      join(itemDir, "item.json"),
      JSON.stringify(
        {
          id: itemId,
          vault_id: vaultId,
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

    expect(await exists(join(itemDir, "item.json"))).toBe(false);
    const md = await readFile(join(itemDir, "content.md"), "utf8");
    const parsed = parseDocumentMarkdown(md);
    expect(parsed.frontmatter.title).toBe("Legacy note");
    expect(parsed.frontmatter.description).toBe("keep me");
    expect(parsed.body).toBe("# Legacy");

    const migratedVault = JSON.parse(
      await readFile(join(vaultPath, "vault.meta.json"), "utf8"),
    );
    expect(migratedVault.schema_version).toBe(SCHEMA_VERSION);
    expect(migratedVault.settings).toEqual({});

    // Idempotent second pass
    const again = await migrateVaultSchema(fs, vaultPath);
    expect(again.schema_version).toBe(SCHEMA_VERSION);
    expect(await exists(join(itemDir, "item.json"))).toBe(false);

    expect(await fs.exists(itemsRoot(vaultPath))).toBe(true);
  });

  it("ignores leftover .collector-touch stamp under items/", async () => {
    const fs = new NodeFileSystemAdapter();
    const root = await mkdtemp(join(tmpdir(), "collector-vault-touch-"));
    vaultPath = root;
    const itemId = "11111111-1111-4111-8111-111111111111";
    const timestamp = "2026-01-01T00:00:00.000Z";
    const vaultId = "22222222-2222-4222-8222-222222222222";

    await writeFile(
      join(vaultPath, "vault.meta.json"),
      JSON.stringify(
        {
          id: vaultId,
          name: "Touch Stamp Vault",
          description: "",
          is_default: true,
          schema_version: SCHEMA_VERSION,
          settings: {},
          created_at: timestamp,
          updated_at: timestamp,
        },
        null,
        2,
      ),
    );
    await writeFile(join(vaultPath, "tags.json"), JSON.stringify({ tags: [] }));

    const itemDir = itemRoot(vaultPath, itemId);
    await mkdir(itemDir, { recursive: true });
    await writeFile(
      join(itemDir, "item.json"),
      JSON.stringify(
        {
          id: itemId,
          vault_id: vaultId,
          title: "Note",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          is_archived: false,
          is_favorite: false,
          created_at: timestamp,
          updated_at: timestamp,
        },
        null,
        2,
      ),
    );
    await writeFile(join(itemsRoot(vaultPath), RECONCILE_TOUCH_FILE), "1");

    const meta = await migrateVaultSchema(fs, vaultPath);
    expect(meta.schema_version).toBe(SCHEMA_VERSION);
    expect(await exists(join(itemDir, "item.json"))).toBe(false);
    expect(await exists(join(itemDir, "content.md"))).toBe(true);
  });
});
