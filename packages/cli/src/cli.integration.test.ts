import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  startServiceHost,
  defaultServiceIpcPath,
} from "@collector/service/host";
import { runCollectorCli } from "./run.js";

describe("collector CLI IPC (#172)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("health succeeds against a live host; fails clearly when absent", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-cli-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    const lines: string[] = [];
    const code = await runCollectorCli(["--data-dir", dataDir, "health"], {
      stdout: (line) => lines.push(line),
      stderr: (line) => lines.push(`ERR:${line}`),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/"ok"\s*:\s*true/);
    await host.close();

    const err: string[] = [];
    const missing = await runCollectorCli(
      ["--ipc-path", defaultServiceIpcPath(dataDir), "health"],
      {
        stdout: () => {},
        stderr: (line) => err.push(line),
      },
    );
    expect(missing).toBe(1);
    expect(err.join("\n")).toMatch(
      /not running|not_connected|IPC connect failed|token file missing/i,
    );
  });

  it("search and get-item round-trip via IPC (empty vault)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-cli-rw-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    const out: string[] = [];
    const searchCode = await runCollectorCli(
      ["--data-dir", dataDir, "search", "nothing-matches"],
      {
        stdout: (line) => out.push(line),
        stderr: (line) => out.push(`ERR:${line}`),
      },
    );
    expect(searchCode).toBe(0);
    expect(JSON.parse(out.join("\n"))).toEqual([]);

    const missing: string[] = [];
    const getCode = await runCollectorCli(
      ["--data-dir", dataDir, "get-item", "missing-id"],
      {
        stdout: () => {},
        stderr: (line) => missing.push(line),
      },
    );
    expect(getCode).toBe(1);
    expect(missing.join("\n").length).toBeGreaterThan(0);
    await host.close();
  });

  it("create/update/delete item via IPC (#173)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-cli-write-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });

    const createdOut: string[] = [];
    const createCode = await runCollectorCli(
      [
        "--data-dir",
        dataDir,
        "create-item",
        "--title",
        "CLI note",
        "--type",
        "note",
        "--content",
        "hello from cli",
      ],
      {
        stdout: (line) => createdOut.push(line),
        stderr: (line) => createdOut.push(`ERR:${line}`),
      },
    );
    expect(createCode).toBe(0);
    const created = JSON.parse(createdOut.join("\n")) as { id: string; title: string };
    expect(created.title).toBe("CLI note");
    expect(created.id).toBeTruthy();

    const updatedOut: string[] = [];
    const updateCode = await runCollectorCli(
      [
        "--data-dir",
        dataDir,
        "update-item",
        created.id,
        "--title",
        "CLI note edited",
      ],
      {
        stdout: (line) => updatedOut.push(line),
        stderr: (line) => updatedOut.push(`ERR:${line}`),
      },
    );
    expect(updateCode).toBe(0);
    expect(JSON.parse(updatedOut.join("\n")).title).toBe("CLI note edited");

    const typedOut: string[] = [];
    const typedCode = await runCollectorCli(
      [
        "--data-dir",
        dataDir,
        "update-item",
        created.id,
        "--type",
        "article",
      ],
      {
        stdout: (line) => typedOut.push(line),
        stderr: (line) => typedOut.push(`ERR:${line}`),
      },
    );
    expect(typedCode).toBe(0);
    expect(JSON.parse(typedOut.join("\n")).content_type).toBe("article");

    const tagOut: string[] = [];
    const tagCode = await runCollectorCli(
      ["--data-dir", dataDir, "create-tag", "--name", "cli-351"],
      {
        stdout: (line) => tagOut.push(line),
        stderr: (line) => tagOut.push(`ERR:${line}`),
      },
    );
    expect(tagCode).toBe(0);

    const taggedOut: string[] = [];
    const taggedCode = await runCollectorCli(
      [
        "--data-dir",
        dataDir,
        "update-item",
        created.id,
        "--tags",
        "cli-351,brand-new-cli-tag",
      ],
      {
        stdout: (line) => taggedOut.push(line),
        stderr: (line) => taggedOut.push(`ERR:${line}`),
      },
    );
    expect(taggedCode).toBe(0);
    expect(JSON.parse(taggedOut.join("\n")).tag_ids).toHaveLength(2);

    const sourcePeek: string[] = [];
    const sourcePeekCode = await runCollectorCli(
      ["--data-dir", dataDir, "get-item-source", created.id],
      {
        stdout: (line) => sourcePeek.push(line),
        stderr: (line) => sourcePeek.push(`ERR:${line}`),
      },
    );
    expect(sourcePeekCode).toBe(0);
    expect(sourcePeek.join("\n")).toMatch(/brand-new-cli-tag/);
    expect(sourcePeek.join("\n")).toMatch(/cli-351/);

    const sourceOut: string[] = [];
    const sourceCode = await runCollectorCli(
      ["--data-dir", dataDir, "get-item-source", created.id],
      {
        stdout: (line) => sourceOut.push(line),
        stderr: (line) => sourceOut.push(`ERR:${line}`),
      },
    );
    expect(sourceCode).toBe(0);
    const raw = sourceOut.join("\n");
    expect(raw).toMatch(/title:/);

    const sourceUpdatedOut: string[] = [];
    const sourceUpdatedCode = await runCollectorCli(
      [
        "--data-dir",
        dataDir,
        "update-item-source",
        created.id,
        "--content",
        raw.replace(/CLI note edited/g, "CLI via source"),
      ],
      {
        stdout: (line) => sourceUpdatedOut.push(line),
        stderr: (line) => sourceUpdatedOut.push(`ERR:${line}`),
      },
    );
    expect(sourceUpdatedCode).toBe(0);
    expect(JSON.parse(sourceUpdatedOut.join("\n")).title).toBe("CLI via source");

    const folderOut: string[] = [];
    const folderCode = await runCollectorCli(
      ["--data-dir", dataDir, "create-folder", "Shelf"],
      {
        stdout: (line) => folderOut.push(line),
        stderr: (line) => folderOut.push(`ERR:${line}`),
      },
    );
    expect(folderCode).toBe(0);

    const moveOut: string[] = [];
    const moveCode = await runCollectorCli(
      ["--data-dir", dataDir, "move-item", created.id, "--folder", "Shelf"],
      {
        stdout: (line) => moveOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(moveCode).toBe(0);
    const moved = JSON.parse(moveOut.join("\n")) as {
      ok: boolean;
      itemId: string;
      folder_path: string;
    };
    expect(moved.ok).toBe(true);
    expect(moved.itemId).not.toBe(created.id);
    expect(moved.itemId).toMatch(/^Shelf\//);
    expect(moved.folder_path).toBe("Shelf");

    const folderCrudOut: string[] = [];
    const createNested = await runCollectorCli(
      ["--data-dir", dataDir, "create-folder", "Work/Drafts"],
      {
        stdout: (line) => folderCrudOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(createNested).toBe(0);

    const listOut: string[] = [];
    const listCode = await runCollectorCli(
      ["--data-dir", dataDir, "list-folders"],
      {
        stdout: (line) => listOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(listCode).toBe(0);
    expect(Array.isArray(JSON.parse(listOut.join("\n")))).toBe(true);

    const renameOut: string[] = [];
    const renameCode = await runCollectorCli(
      ["--data-dir", dataDir, "rename-folder", "Work/Drafts", "Work/Ready"],
      {
        stdout: (line) => renameOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(renameCode).toBe(0);
    expect(JSON.parse(renameOut.join("\n")).path).toBe("Work/Ready");

    const archiveCode = await runCollectorCli(
      ["--data-dir", dataDir, "create-folder", "Archive"],
      {
        stdout: () => {},
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(archiveCode).toBe(0);

    const moveFolderOut: string[] = [];
    const moveFolderCode = await runCollectorCli(
      ["--data-dir", dataDir, "move-folder", "Work/Ready", "Archive/Ready"],
      {
        stdout: (line) => moveFolderOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(moveFolderCode).toBe(0);
    expect(JSON.parse(moveFolderOut.join("\n")).path).toBe("Archive/Ready");

    const deleteFolderOut: string[] = [];
    const deleteFolderCode = await runCollectorCli(
      ["--data-dir", dataDir, "delete-folder", "Archive/Ready"],
      {
        stdout: (line) => deleteFolderOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(deleteFolderCode).toBe(0);
    expect(JSON.parse(deleteFolderOut.join("\n"))).toEqual({
      ok: true,
      deleted: "Archive/Ready",
    });

    const deleteCode = await runCollectorCli(
      ["--data-dir", dataDir, "delete-item", created.id],
      {
        stdout: () => {},
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(deleteCode).toBe(0);

    const refuse: string[] = [];
    const refuseCode = await runCollectorCli(
      [
        "--ipc-path",
        defaultServiceIpcPath(dataDir) + ".missing",
        "--token",
        "unused",
        "create-item",
        "--title",
        "nope",
      ],
      {
        stdout: () => {},
        stderr: (line) => refuse.push(line),
      },
    );
    expect(refuseCode).toBe(1);
    expect(refuse.join("\n")).toMatch(
      /not running|not_connected|IPC connect failed|token file missing/i,
    );

    await host.close();
  });

  it("media attach/list/replace/delete/set-cover (#353)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-cli-media-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });

    const createOut: string[] = [];
    const createCode = await runCollectorCli(
      [
        "--data-dir",
        dataDir,
        "create-item",
        "--title",
        "CLI media",
        "--content",
        "body",
      ],
      {
        stdout: (line) => createOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(createCode).toBe(0);
    const created = JSON.parse(createOut.join("\n")) as { id: string };

    const pngPath = join(dataDir, "dot.png");
    writeFileSync(
      pngPath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const png2Path = join(dataDir, "dot2.png");
    writeFileSync(png2Path, readFileSync(pngPath));

    const attachOut: string[] = [];
    const attachCode = await runCollectorCli(
      ["--data-dir", dataDir, "attach-media", created.id, "--file", pngPath],
      {
        stdout: (line) => attachOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(attachCode).toBe(0);
    const attached = JSON.parse(attachOut.join("\n")) as {
      id: string;
      filename: string;
    };
    expect(attached.filename).toBe("dot.png");

    const listOut: string[] = [];
    const listCode = await runCollectorCli(
      ["--data-dir", dataDir, "list-item-media", created.id],
      {
        stdout: (line) => listOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(listCode).toBe(0);
    expect(
      (JSON.parse(listOut.join("\n")) as Array<{ id: string }>).some(
        (m) => m.id === attached.id,
      ),
    ).toBe(true);

    const replaceOut: string[] = [];
    const replaceCode = await runCollectorCli(
      [
        "--data-dir",
        dataDir,
        "replace-media",
        created.id,
        attached.id,
        "--file",
        png2Path,
      ],
      {
        stdout: (line) => replaceOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(replaceCode).toBe(0);
    const replaced = JSON.parse(replaceOut.join("\n")) as {
      id: string;
      filename: string;
    };
    expect(replaced.id).toBe(attached.id);
    expect(replaced.filename).toBe("dot2.png");

    const coverOut: string[] = [];
    const coverCode = await runCollectorCli(
      ["--data-dir", dataDir, "set-item-cover", created.id, attached.id],
      {
        stdout: (line) => coverOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(coverCode).toBe(0);
    // Cover SoT is cover.webp on disk (#276/#279); FM thumbnail stays null.
    expect(JSON.parse(coverOut.join("\n")).thumbnail ?? null).toBeNull();

    const deleteOut: string[] = [];
    const deleteCode = await runCollectorCli(
      ["--data-dir", dataDir, "delete-media", created.id, attached.id],
      {
        stdout: (line) => deleteOut.push(line),
        stderr: (line) => {
          throw new Error(line);
        },
      },
    );
    expect(deleteCode).toBe(0);
    expect(JSON.parse(deleteOut.join("\n"))).toEqual({
      ok: true,
      deleted: attached.id,
    });

    await host.close();
  });
});
