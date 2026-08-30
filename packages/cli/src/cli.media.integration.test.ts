import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startServiceHost } from "@collector/service/host";
import { cliArgs, useTempDataDirs } from "./cli-integration-test-harness.js";
import { runCollectorCli } from "./run.js";

describe("collector CLI media (#353 / #922)", () => {
  const { mktemp } = useTempDataDirs();

  it("media attach/list/replace/delete/set-cover (#353)", async () => {
    const dataDir = mktemp("collector-cli-media-");
    const host = await startServiceHost({ dataDir, host: "127.0.0.1", port: 0 });
    try {
      const createOut: string[] = [];
      const createCode = await runCollectorCli(
        cliArgs(
          host,
          dataDir,
          "create-item",
          "--title",
          "CLI media",
          "--content",
          "body",
        ),
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
        cliArgs(host, dataDir, "attach-media", created.id, "--file", pngPath),
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
        cliArgs(host, dataDir, "list-item-media", created.id),
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
        cliArgs(
          host,
          dataDir,
          "replace-media",
          created.id,
          attached.id,
          "--file",
          png2Path,
        ),
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
        cliArgs(host, dataDir, "set-item-cover", created.id, attached.id),
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
        cliArgs(host, dataDir, "delete-media", created.id, attached.id),
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
    } finally {
      await host.close();
    }
  });
});
