import { describe, expect, it } from "vitest";
import {
  buildCanonicalFrontmatter,
  parseDocumentMarkdown,
  parseKnownFrontmatter,
  resolveFrontmatterDates,
  serializeDocumentMarkdown,
} from "./frontmatter.js";

describe("parseDocumentMarkdown", () => {
  it("parses YAML frontmatter and body", () => {
    const raw = `---
title: Hello
tags:
  - a
  - b
---
# Body
`;
    const parsed = parseDocumentMarkdown(raw);
    expect(parsed.detectedFormat).toBe("yaml");
    expect(parsed.frontmatter.title).toBe("Hello");
    expect(parsed.frontmatter.tags).toEqual(["a", "b"]);
    expect(parsed.body).toBe("# Body\n");
  });

  it("parses JSON frontmatter inside ---", () => {
    const raw = `---
{"title":"Json Title","tags":["x"]}
---
body
`;
    const parsed = parseDocumentMarkdown(raw);
    expect(parsed.detectedFormat).toBe("json");
    expect(parsed.frontmatter.title).toBe("Json Title");
    expect(parsed.body).toBe("body\n");
  });

  it("parses TOML frontmatter with +++", () => {
    const raw = `+++
title = "Toml Title"
tags = ["t"]
+++
hi
`;
    const parsed = parseDocumentMarkdown(raw);
    expect(parsed.detectedFormat).toBe("toml");
    expect(parsed.frontmatter.title).toBe("Toml Title");
    expect(parsed.body).toBe("hi\n");
  });

  it("returns empty frontmatter when absent", () => {
    const parsed = parseDocumentMarkdown("# just body\n");
    expect(parsed.detectedFormat).toBeNull();
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe("# just body\n");
  });

  it("fails loud on missing closing delimiter", () => {
    expect(() => parseDocumentMarkdown("---\ntitle: x\n")).toThrow(/closing delimiter/);
  });

  it("fails loud on non-object YAML frontmatter", () => {
    expect(() => parseDocumentMarkdown("---\n- just\n- list\n---\n")).toThrow(/mapping/);
  });
});

describe("serializeDocumentMarkdown round-trip", () => {
  it("round-trips YAML canonically", () => {
    const fm = buildCanonicalFrontmatter({
      title: "Round",
      tags: ["one", "two"],
      description: "desc",
      created: "2024-01-02T03:04:05.000Z",
    });
    const serialized = serializeDocumentMarkdown(fm, "Hello world\n");
    const parsed = parseDocumentMarkdown(serialized);
    expect(parsed.frontmatter.title).toBe("Round");
    expect(parsed.frontmatter.tags).toEqual(["one", "two"]);
    expect(parsed.body).toBe("Hello world\n");
    expect(serializeDocumentMarkdown(parsed.frontmatter, parsed.body)).toBe(serialized);
  });

  it("normalizes JSON import to YAML on serialize", () => {
    const parsed = parseDocumentMarkdown(`---
{"title":"FromJson","url":"https://example.com"}
---
x
`);
    const known = parseKnownFrontmatter(parsed.frontmatter);
    const canon = buildCanonicalFrontmatter({
      title: known.title!,
      url: known.url,
    });
    const out = serializeDocumentMarkdown(canon, parsed.body);
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("title: FromJson");
    expect(out).not.toContain("{");
  });
});

describe("resolveFrontmatterDates", () => {
  it("prefers created_at / updated_at", () => {
    const dates = resolveFrontmatterDates(
      parseKnownFrontmatter({
        created_at: "2020-01-01T00:00:00.000Z",
        updated_at: "2020-02-01T00:00:00.000Z",
      }),
    );
    expect(dates.created_at).toBe("2020-01-01T00:00:00.000Z");
    expect(dates.updated_at).toBe("2020-02-01T00:00:00.000Z");
  });

  it("accepts created / updated aliases", () => {
    const dates = resolveFrontmatterDates(
      parseKnownFrontmatter({
        created: "2021-06-15T12:00:00.000Z",
        updated: "2021-06-16T12:00:00.000Z",
      }),
    );
    expect(dates.created_at).toBe("2021-06-15T12:00:00.000Z");
  });

  it("fails on invalid date", () => {
    expect(() =>
      resolveFrontmatterDates(parseKnownFrontmatter({ created: "not-a-date" })),
    ).toThrow(/Invalid date/);
  });
});
