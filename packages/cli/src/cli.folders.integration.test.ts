import { describe, expect, it } from "vitest";
import { startServiceHost } from "@collector/service/host";
import { cliArgs, useTempDataDirs } from "./cli-integration-test-harness.js";
import { runCollectorCli } from "./run.js";

describe("collector CLI folders (#172 / #922)", () => {
  const { mktemp } = useTempDataDirs();

  it("create/list/rename/move/delete folders and list-folder-items", async () => {
    const dataDir = mktemp("collector-cli-folders-");
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    try {
      const createdOut: string[] = [];
      const createCode = await runCollectorCli(
        cliArgs(
          host,
          dataDir,
          "create-item",
          "--title",
          "CLI folder item",
          "--content",
          "body",
        ),
        {
          stdout: (line) => createdOut.push(line),
          stderr: (line) => {
            throw new Error(line);
          },
        },
      );
      expect(createCode).toBe(0);
      const created = JSON.parse(createdOut.join("\n")) as { id: string };

      const folderOut: string[] = [];
      const folderCode = await runCollectorCli(
        cliArgs(host, dataDir, "create-folder", "Shelf"),
        {
          stdout: (line) => folderOut.push(line),
          stderr: (line) => folderOut.push(`ERR:${line}`),
        },
      );
      expect(folderCode).toBe(0);

      const moveOut: string[] = [];
      const moveCode = await runCollectorCli(
        cliArgs(host, dataDir, "move-item", created.id, "--folder", "Shelf"),
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

      const createNested = await runCollectorCli(
        cliArgs(host, dataDir, "create-folder", "Work/Drafts"),
        {
          stdout: () => {},
          stderr: (line) => {
            throw new Error(line);
          },
        },
      );
      expect(createNested).toBe(0);

      const listOut: string[] = [];
      const listCode = await runCollectorCli(
        cliArgs(host, dataDir, "list-folders"),
        {
          stdout: (line) => listOut.push(line),
          stderr: (line) => {
            throw new Error(line);
          },
        },
      );
      expect(listCode).toBe(0);
      expect(Array.isArray(JSON.parse(listOut.join("\n")))).toBe(true);

      const listItemsOut: string[] = [];
      const listItemsCode = await runCollectorCli(
        cliArgs(host, dataDir, "list-folder-items", "Shelf"),
        {
          stdout: (line) => listItemsOut.push(line),
          stderr: (line) => {
            throw new Error(line);
          },
        },
      );
      expect(listItemsCode).toBe(0);
      const shelfItems = JSON.parse(listItemsOut.join("\n")) as Array<{
        id: string;
        folder_path: string;
      }>;
      expect(shelfItems.some((item) => item.id === moved.itemId)).toBe(true);
      expect(shelfItems.every((item) => item.folder_path === "Shelf")).toBe(
        true,
      );

      const missingItemsErr: string[] = [];
      const missingItemsCode = await runCollectorCli(
        cliArgs(host, dataDir, "list-folder-items", "DoesNotExist"),
        {
          stdout: () => {},
          stderr: (line) => missingItemsErr.push(line),
        },
      );
      expect(missingItemsCode).not.toBe(0);
      expect(missingItemsErr.join("\n")).toMatch(/Folder not found/i);

      const renameOut: string[] = [];
      const renameCode = await runCollectorCli(
        cliArgs(host, dataDir, "rename-folder", "Work/Drafts", "Work/Ready"),
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
        cliArgs(host, dataDir, "create-folder", "Archive"),
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
        cliArgs(host, dataDir, "move-folder", "Work/Ready", "Archive/Ready"),
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
        cliArgs(host, dataDir, "delete-folder", "Archive/Ready"),
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
    } finally {
      await host.close();
    }
  });
});
