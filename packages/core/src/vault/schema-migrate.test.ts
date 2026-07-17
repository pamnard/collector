import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION } from "@collector/shared";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import {
  migrateVaultSchema,
  preflightLegacyVaultLayout,
} from "../vault/schema-migrate.js";
import {
  legacyItemRoot,
  legacyItemsRoot,
  RECONCILE_TOUCH_FILE,
} from "../vault/paths.js";
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

  it("migrates a v1 vault fixture to the tree layout without data loss", async () => {
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

    const itemDir = legacyItemRoot(vaultPath, itemId);
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
          created_at: timestamp,
          updated_at: timestamp,
        },
        null,
        2,
      ),
    );
    await writeFile(join(itemDir, "content.md"), "# Legacy");

    const report = await migrateVaultSchema(fs, vaultPath);
    expect(report.meta.schema_version).toBe(SCHEMA_VERSION);
    expect(report.meta.settings).toEqual({});
    expect(report.itemsMigrated).toBe(1);

    const destPath = join(vaultPath, `${itemId}.md`);
    expect(await exists(destPath)).toBe(true);
    expect(await exists(itemDir)).toBe(false);

    const md = await readFile(destPath, "utf8");
    const parsed = parseDocumentMarkdown(md);
    expect(parsed.frontmatter.title).toBe("Legacy note");
    expect(parsed.frontmatter.description).toBe("keep me");
    expect(parsed.body).toBe("# Legacy");

    const migratedVault = JSON.parse(
      await readFile(join(vaultPath, "vault.meta.json"), "utf8"),
    );
    expect(migratedVault.schema_version).toBe(SCHEMA_VERSION);
    expect(migratedVault.settings).toEqual({});

    // Legacy items/ root is fully retired once every item is migrated.
    expect(await fs.exists(legacyItemsRoot(vaultPath))).toBe(false);

    // Idempotent second pass
    const again = await migrateVaultSchema(fs, vaultPath);
    expect(again.meta.schema_version).toBe(SCHEMA_VERSION);
    expect(await exists(destPath)).toBe(true);
  });

  it("keeps content.md bodies that start with --- when item.json is present", async () => {
    const fs = new NodeFileSystemAdapter();
    const root = await mkdtemp(join(tmpdir(), "collector-vault-hr-"));
    vaultPath = root;
    const itemId = "11111111-1111-4111-8111-111111111111";
    const vaultId = "22222222-2222-4222-8222-222222222222";
    const timestamp = "2026-01-01T00:00:00.000Z";
    const body = "---\nnot: frontmatter\n---\n\nActual body";

    await writeFile(
      join(vaultPath, "vault.meta.json"),
      JSON.stringify(
        {
          id: vaultId,
          name: "HR Vault",
          description: "",
          is_default: true,
          schema_version: 2,
          settings: {},
          created_at: timestamp,
          updated_at: timestamp,
        },
        null,
        2,
      ),
    );
    await writeFile(join(vaultPath, "tags.json"), JSON.stringify({ tags: [] }));

    const itemDir = legacyItemRoot(vaultPath, itemId);
    await mkdir(itemDir, { recursive: true });
    await writeFile(
      join(itemDir, "item.json"),
      JSON.stringify(
        {
          id: itemId,
          vault_id: vaultId,
          title: "Dashed body",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          created_at: timestamp,
          updated_at: timestamp,
          schema_version: 2,
        },
        null,
        2,
      ),
    );
    await writeFile(join(itemDir, "content.md"), body);

    const preflight = await preflightLegacyVaultLayout(fs, vaultPath);
    expect(preflight.issues).toEqual([]);

    const report = await migrateVaultSchema(fs, vaultPath);
    expect(report.itemsMigrated).toBe(1);

    const md = await readFile(join(vaultPath, `${itemId}.md`), "utf8");
    const parsed = parseDocumentMarkdown(md);
    expect(parsed.frontmatter.title).toBe("Dashed body");
    // Writer may wrap body; the legacy --- block must still be in the document body.
    expect(parsed.body).toContain("not: frontmatter");
    expect(parsed.body).toContain("Actual body");
  });

  it("resumes after a partial item migrate (dest md exists, legacy dir remains)", async () => {
    const fs = new NodeFileSystemAdapter();
    const root = await mkdtemp(join(tmpdir(), "collector-vault-resume-"));
    vaultPath = root;
    const itemId = "11111111-1111-4111-8111-111111111111";
    const vaultId = "22222222-2222-4222-8222-222222222222";
    const timestamp = "2026-01-01T00:00:00.000Z";

    await writeFile(
      join(vaultPath, "vault.meta.json"),
      JSON.stringify(
        {
          id: vaultId,
          name: "Resume Vault",
          description: "",
          is_default: true,
          schema_version: 2,
          settings: {},
          created_at: timestamp,
          updated_at: timestamp,
        },
        null,
        2,
      ),
    );
    await writeFile(join(vaultPath, "tags.json"), JSON.stringify({ tags: [] }));

    const itemDir = legacyItemRoot(vaultPath, itemId);
    await mkdir(itemDir, { recursive: true });
    await writeFile(
      join(itemDir, "item.json"),
      JSON.stringify(
        {
          id: itemId,
          vault_id: vaultId,
          title: "Partial",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          created_at: timestamp,
          updated_at: timestamp,
          schema_version: 2,
        },
        null,
        2,
      ),
    );
    await writeFile(join(itemDir, "content.md"), "body from legacy");
    await mkdir(join(itemDir, "media"), { recursive: true });
    await writeFile(join(itemDir, "media", "manifest.json"), '{"files":[]}');
    // Simulate crash after writing dest md but before removing legacy:
    await writeFile(join(vaultPath, `${itemId}.md`), "---\ntitle: stale\n---\n\nold\n");

    const report = await migrateVaultSchema(fs, vaultPath);
    expect(report.itemsMigrated).toBe(1);
    expect(await exists(itemDir)).toBe(false);
    expect(await exists(join(vaultPath, `${itemId}.media`))).toBe(true);

    const md = await readFile(join(vaultPath, `${itemId}.md`), "utf8");
    const parsed = parseDocumentMarkdown(md);
    expect(parsed.frontmatter.title).toBe("Partial");
    expect(parsed.body).toBe("body from legacy");
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

    const itemDir = legacyItemRoot(vaultPath, itemId);
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
          created_at: timestamp,
          updated_at: timestamp,
        },
        null,
        2,
      ),
    );
    await writeFile(join(legacyItemsRoot(vaultPath), RECONCILE_TOUCH_FILE), "1");

    const report = await migrateVaultSchema(fs, vaultPath);
    expect(report.meta.schema_version).toBe(SCHEMA_VERSION);

    const destPath = join(vaultPath, `${itemId}.md`);
    expect(await exists(destPath)).toBe(true);
    expect(await exists(itemDir)).toBe(false);
    expect(await fs.exists(legacyItemsRoot(vaultPath))).toBe(false);
  });

  it("preflight reports invalid item.json without writing", async () => {
    const fs = new NodeFileSystemAdapter();
    const root = await mkdtemp(join(tmpdir(), "collector-vault-pf-"));
    vaultPath = root;
    const itemId = "11111111-1111-4111-8111-111111111111";
    const vaultId = "22222222-2222-4222-8222-222222222222";
    const timestamp = "2026-01-01T00:00:00.000Z";

    await writeFile(
      join(vaultPath, "vault.meta.json"),
      JSON.stringify(
        {
          id: vaultId,
          name: "PF Vault",
          description: "",
          is_default: true,
          schema_version: 2,
          settings: {},
          created_at: timestamp,
          updated_at: timestamp,
        },
        null,
        2,
      ),
    );
    await writeFile(join(vaultPath, "tags.json"), JSON.stringify({ tags: [] }));

    const itemDir = legacyItemRoot(vaultPath, itemId);
    await mkdir(itemDir, { recursive: true });
    await writeFile(
      join(itemDir, "item.json"),
      JSON.stringify(
        {
          id: itemId,
          vault_id: vaultId,
          title: "",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          created_at: timestamp,
          updated_at: timestamp,
        },
        null,
        2,
      ),
    );

    const preflight = await preflightLegacyVaultLayout(fs, vaultPath);
    expect(preflight.issues).toHaveLength(1);
    expect(preflight.issues[0]?.uuid).toBe(itemId);
    expect(await exists(itemDir)).toBe(true);
  });
});
