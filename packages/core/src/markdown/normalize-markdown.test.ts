import { describe, expect, it } from "vitest";
import { normalizeMarkdown } from "./normalize-markdown.js";

describe("normalizeMarkdown", () => {
  it("returns changed:false for already-clean input (no-op)", () => {
    const raw = "# Title\n\nParagraph.\n";
    const result = normalizeMarkdown(raw);
    expect(result).toEqual({ text: raw, changed: false });
  });

  it("is idempotent: second pass on fixed input yields changed:false", () => {
    const dirty = "#Title\n\n_hello_\n";
    const first = normalizeMarkdown(dirty);
    expect(first.changed).toBe(true);
    const second = normalizeMarkdown(first.text);
    expect(second).toEqual({ text: first.text, changed: false });
  });

  it("MD009 strips trailing spaces", () => {
    const result = normalizeMarkdown("hello   \nworld\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("hello\nworld\n");
  });

  it("MD010 converts hard tabs to spaces", () => {
    const result = normalizeMarkdown("a\tb\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("a b\n");
  });

  it("MD012 collapses multiple consecutive blank lines", () => {
    const result = normalizeMarkdown("a\n\n\n\nb\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("a\n\nb\n");
  });

  it("MD018 inserts space after # on ATX headings", () => {
    const result = normalizeMarkdown("#Heading\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("# Heading\n");
  });

  it("MD019 collapses multiple spaces after # on ATX headings", () => {
    const result = normalizeMarkdown("#  Heading\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("# Heading\n");
  });

  it("MD022 adds blank lines around headings", () => {
    const result = normalizeMarkdown("text\n# Heading\ntext\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("text\n\n# Heading\n\ntext\n");
  });

  it("MD023 moves headings to the beginning of the line", () => {
    const result = normalizeMarkdown(" # Heading\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("# Heading\n");
  });

  it("MD027 collapses multiple spaces after blockquote marker", () => {
    const result = normalizeMarkdown(">  quote\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("> quote\n");
  });

  it("MD030 normalizes spaces after list markers", () => {
    const result = normalizeMarkdown("-  item\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("- item\n");
  });

  it("MD031 adds blank lines around fenced code blocks", () => {
    const result = normalizeMarkdown("text\n```\ncode\n```\ntext\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("text\n\n```\ncode\n```\n\ntext\n");
  });

  it("MD032 adds blank lines around lists", () => {
    const result = normalizeMarkdown("text\n- item\ntext\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("text\n\n- item\ntext\n");
  });

  it("MD037 removes spaces inside emphasis markers", () => {
    const result = normalizeMarkdown("this is * not * emphasis\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("this is *not* emphasis\n");
  });

  it("MD038 removes spaces inside code spans", () => {
    const result = normalizeMarkdown("`some text `\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("`some text`\n");
  });

  it("MD039 removes spaces inside link text", () => {
    const result = normalizeMarkdown("[ link ](url)\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("[link](url)\n");
  });

  it("MD047 ensures file ends with a single newline", () => {
    const result = normalizeMarkdown("no newline");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("no newline\n");
  });

  it("MD004 rewrites unordered list markers to dash", () => {
    const result = normalizeMarkdown("* item\n* two\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("- item\n- two\n");
  });

  it("MD048 keeps backtick fences (configured style)", () => {
    const raw = "```\ncode\n```\n";
    const result = normalizeMarkdown(raw);
    expect(result).toEqual({ text: raw, changed: false });
  });

  it("MD049 rewrites emphasis to asterisk style", () => {
    const result = normalizeMarkdown("_emph_\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("*emph*\n");
  });

  it("MD050 rewrites strong to asterisk style", () => {
    const result = normalizeMarkdown("__strong__\n");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("**strong**\n");
  });

  it("does not enable MD013 line-length (long lines stay)", () => {
    const long = `# Title\n\n${"x".repeat(200)}\n`;
    const result = normalizeMarkdown(long);
    expect(result.changed).toBe(false);
    expect(result.text).toBe(long);
  });
});
