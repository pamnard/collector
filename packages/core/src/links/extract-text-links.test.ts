import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTextLinks } from "./extract-text-links.js";

const fixturesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../shared/fixtures/text-link-cases.json",
);

interface FixtureCase {
  name: string;
  body: string;
  expected: Array<{
    kind: "wikilink" | "md";
    rawTarget: string;
    displayText: string | null;
  }>;
}

const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8")) as FixtureCase[];

describe("extractTextLinks", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const links = extractTextLinks(fixture.body);
      expect(
        links.map((link) => ({
          kind: link.kind,
          rawTarget: link.rawTarget,
          displayText: link.displayText,
        })),
      ).toEqual(fixture.expected);
      for (const link of links) {
        expect(link.position).toBeGreaterThanOrEqual(0);
        expect(fixture.body.slice(link.position).length).toBeGreaterThan(0);
      }
    });
  }

  it("records positions in document order", () => {
    const body = "[[First]] middle [[Second]]";
    const links = extractTextLinks(body);
    expect(links.map((l) => l.rawTarget)).toEqual(["First", "Second"]);
    expect(links[0]!.position).toBeLessThan(links[1]!.position);
  });

  it("skips markdown images so absolute media paths stay intact (#590)", () => {
    const mediaPath =
      "/home/user/.local/share/com.collector.app/collector/vaults/v/media/id/a.png";
    const body = `Intro\n\n![alt text](${mediaPath})\n\nSee [[Note]] and [doc](Folder/doc.md).\n`;
    const links = extractTextLinks(body);
    expect(
      links.map((link) => ({
        kind: link.kind,
        rawTarget: link.rawTarget,
        displayText: link.displayText,
      })),
    ).toEqual([
      { kind: "wikilink", rawTarget: "Note", displayText: null },
      { kind: "md", rawTarget: "Folder/doc.md", displayText: "doc" },
    ]);
  });
});
